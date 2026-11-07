<?php
require '../../../zb_system/function/c_system_base.php';
$zbp->Load();
require_once __DIR__ . '/common.php';

if (!$zbp->CheckPlugin('STOTPOAuth')) {
    http_response_code(404);
    exit('Plugin disabled');
}

stotp_oauth_session_start();

if (($_GET['action'] ?? '') === 'start') {
    stotp_oauth_start();
}
stotp_oauth_callback();

function stotp_oauth_http($method, $url, $body = null, $headers = array())
{
    $method = strtoupper($method);
    if (function_exists('curl_init')) {
        $ch = curl_init($url);
        $options = array(
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_CONNECTTIMEOUT => 8,
            CURLOPT_TIMEOUT => 20,
            CURLOPT_FOLLOWLOCATION => false,
            CURLOPT_SSL_VERIFYPEER => true,
            CURLOPT_SSL_VERIFYHOST => 2,
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_USERAGENT => 'STOTPOAuth/1.1 Z-BlogPHP',
        );
        if ($method === 'POST') {
            $options[CURLOPT_POST] = true;
            $options[CURLOPT_POSTFIELDS] = $body === null ? '' : $body;
        }
        curl_setopt_array($ch, $options);
        $raw = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        $error = curl_error($ch);
        curl_close($ch);

        return array($status, $raw === false ? '' : $raw, $error);
    }

    $opts = array('http' => array(
        'method' => $method,
        'header' => implode("\r\n", $headers),
        'content' => $method === 'POST' ? (string) $body : '',
        'timeout' => 20,
        'ignore_errors' => true,
        'follow_location' => 0,
    ));
    $raw = @file_get_contents($url, false, stream_context_create($opts));
    $status = 0;
    if (isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $m)) {
        $status = (int) $m[1];
    }

    return array($status, $raw === false ? '' : $raw, $raw === false ? 'request failed' : '');
}

function stotp_oauth_start()
{
    global $zbp;

    $slug = isset($_GET['provider']) ? (string) $_GET['provider'] : '';
    $provider = stotp_oauth_provider_by_slug($slug);
    if (!$provider || !(int) $provider->Enabled) {
        stotp_oauth_fail('OAuth2 Provider 不存在或已停用。');
    }
    if ($provider->AuthURL === '' || $provider->ClientID === '') {
        stotp_oauth_fail('该 Provider 尚未配置 Authorization URL 或 Client ID。');
    }
    $state = bin2hex(random_bytes(16));
    $verifier = $provider->PKCE ? bin2hex(random_bytes(32)) : '';
    $_SESSION['STOTPOAuth_state'] = array(
        'state' => $state,
        'verifier' => $verifier,
        'provider_id' => (int) $provider->ID,
        'created' => time(),
    );
    $params = array();
    if ($provider->Extra !== '') {
        parse_str($provider->Extra, $params);
    }
    $params = array_merge($params, array(
        'response_type' => 'code',
        'client_id' => $provider->ClientID,
        'redirect_uri' => stotp_oauth_callback_url(),
        'scope' => $provider->Scopes,
        'state' => $state,
    ));
    if ($provider->PKCE) {
        $params['code_challenge'] = stotp_oauth_base64url(hash('sha256', $verifier, true));
        $params['code_challenge_method'] = 'S256';
    }
    $separator = strpos($provider->AuthURL, '?') === false ? '?' : '&';
    Redirect($provider->AuthURL . $separator . http_build_query($params, '', '&', PHP_QUERY_RFC3986));
}

function stotp_oauth_callback()
{
    global $zbp;

    $saved = isset($_SESSION['STOTPOAuth_state']) ? $_SESSION['STOTPOAuth_state'] : null;
    unset($_SESSION['STOTPOAuth_state']);
    if (!is_array($saved) || time() - (int) $saved['created'] > 600) {
        stotp_oauth_fail('登录会话已过期，请重新发起登录。');
    }
    $state = isset($_GET['state']) ? (string) $_GET['state'] : '';
    if ($state === '' || !hash_equals((string) $saved['state'], $state)) {
        stotp_oauth_fail('state 校验失败，请重新发起登录。');
    }
    if (!empty($_GET['error'])) {
        $message = isset($_GET['error_description']) ? $_GET['error_description'] : $_GET['error'];
        stotp_oauth_fail('登录服务返回错误：' . (string) $message);
    }
    $code = isset($_GET['code']) ? (string) $_GET['code'] : '';
    if ($code === '') {
        stotp_oauth_fail('登录服务未返回授权码。');
    }
    $provider = stotp_oauth_provider_by_id((int) $saved['provider_id']);
    if (!$provider || !(int) $provider->Enabled) {
        stotp_oauth_fail('OAuth2 Provider 不存在或已停用。');
    }

    $tokenBody = array(
        'grant_type' => 'authorization_code',
        'code' => $code,
        'redirect_uri' => stotp_oauth_callback_url(),
        'client_id' => $provider->ClientID,
    );
    if ((string) $provider->ClientSecret !== '') {
        $tokenBody['client_secret'] = $provider->ClientSecret;
    }
    if ($provider->PKCE && !empty($saved['verifier'])) {
        $tokenBody['code_verifier'] = $saved['verifier'];
    }
    $tokenHeaders = array('Accept: application/json');
    if ($provider->TokenAuth === 'basic') {
        $tokenHeaders[] = 'Authorization: Basic ' . base64_encode($provider->ClientID . ':' . $provider->ClientSecret);
        unset($tokenBody['client_secret']);
    }
    $tokenHeaders[] = 'Content-Type: application/x-www-form-urlencoded';
    list($tokenStatus, $tokenRaw, $tokenError) = stotp_oauth_http(
        'POST',
        $provider->TokenURL,
        http_build_query($tokenBody, '', '&', PHP_QUERY_RFC3986),
        $tokenHeaders
    );
    $token = json_decode($tokenRaw, true);
    if (!is_array($token)) {
        parse_str($tokenRaw, $token);
    }
    if ($tokenStatus < 200 || $tokenStatus >= 300 || empty($token['access_token'])) {
        $detail = isset($token['error_description']) ? $token['error_description'] : (isset($token['error']) ? $token['error'] : $tokenError);
        stotp_oauth_fail('换取 Token 失败：' . (string) $detail);
    }

    $userHeaders = array(
        'Accept: application/json',
        'Authorization: Bearer ' . $token['access_token'],
    );
    list($userStatus, $userRaw, $userError) = stotp_oauth_http(
        strtoupper($provider->UserInfoMethod) === 'POST' ? 'POST' : 'GET',
        $provider->UserInfoURL,
        '',
        $userHeaders
    );
    $profile = json_decode($userRaw, true);
    if ($userStatus < 200 || $userStatus >= 300 || !is_array($profile)) {
        stotp_oauth_fail('读取用户信息失败：' . (string) $userError);
    }

    $subjectValue = stotp_oauth_path($profile, $provider->SubjectField !== '' ? $provider->SubjectField : 'sub');
    if ($subjectValue === null && isset($profile['id'])) {
        $subjectValue = $profile['id'];
    }
    $subject = $subjectValue === null ? '' : (string) $subjectValue;
    if ($subject === '') {
        stotp_oauth_fail('登录服务未返回 Subject（检查 Subject 字段映射）。');
    }
    $emailValue = stotp_oauth_path($profile, $provider->EmailField !== '' ? $provider->EmailField : 'email');
    $email = $emailValue === null ? '' : trim((string) $emailValue);
    if ($email !== '' && function_exists('CheckRegExp') && !CheckRegExp($email, '[email]')) {
        stotp_oauth_fail('登录服务返回的邮箱格式不正确。');
    }
    $verifiedValue = $provider->VerifiedField !== ''
        ? stotp_oauth_path($profile, $provider->VerifiedField) : null;
    $verified = (bool) $provider->TrustEmail
        || $verifiedValue === true || $verifiedValue === 'true';

    $member = null;
    $link = stotp_oauth_find_link((int) $provider->ID, $subject);
    if ($link && (int) $link->MemberID > 0) {
        $member = $zbp->GetMemberByID((int) $link->MemberID);
        if (!$member || (int) $member->ID <= 0) {
            stotp_oauth_fail('绑定的本地账号不存在，请联系管理员。');
        }
    }

    if (!$member && $email === '') {
        stotp_oauth_fail('登录服务未返回邮箱，无法创建或匹配本地账号。');
    }
    if (!$member && !$verified && stotp_oauth_config('allow_email_link', 0)) {
        stotp_oauth_fail('登录服务返回的邮箱未验证，无法自动绑定。');
    }
    if (!$member && $email !== '' && stotp_oauth_config('allow_email_link', 0)) {
        $existing = $zbp->GetMemberByEmail($email);
        if ($existing && (int) $existing->ID > 0) {
            $member = $existing;
        }
    }
    if (!$member && $email !== '') {
        $existing = $zbp->GetMemberByEmail($email);
        if ($existing && (int) $existing->ID > 0) {
            stotp_oauth_fail('该邮箱已存在本地账号，但当前不允许自动绑定。');
        }
    }
    if (!$member) {
        if (!stotp_oauth_config('auto_register', 1)) {
            stotp_oauth_fail('该第三方账号尚未绑定本地账号，且未开启自动注册。');
        }
        if (!$verified) {
            stotp_oauth_fail('邮箱未验证，不能自动注册。');
        }
        $member = stotp_oauth_create_member($profile, $email, $subject, $provider);
    }
    if (!$member || (int) $member->ID <= 0) {
        stotp_oauth_fail('无法创建或读取本地账号。');
    }
    if ((int) $member->Status !== 0) {
        stotp_oauth_fail('本地账号已被禁用。');
    }
    if (!$link) {
        stotp_oauth_save_link((int) $provider->ID, (int) $member->ID, $subject, $email);
    }

    $zbp->user = $member;
    $zbp->islogin = true;
    SetLoginCookie($member, time() + 30 * 86400);

    $redirect = stotp_oauth_config('login_redirect');
    if ($redirect === '') {
        $redirect = rtrim($zbp->host, '/') . '/zb_system/cmd.php?act=admin';
    }
    Redirect($redirect);
}

function stotp_oauth_create_member($profile, $email, $subject, $provider)
{
    global $zbp;

    $existing = $zbp->GetMemberByEmail($email);
    if ($existing && (int) $existing->ID > 0) {
        stotp_oauth_fail('该邮箱已存在本地账号，不能自动注册。');
    }
    $member = new Member();
    $member->Guid = GetGuid();
    $base = strstr($email, '@', true);
    if ($base === false) {
        $base = '';
    }
    $base = preg_replace('/[^a-zA-Z0-9_.-]/', '', $base);
    $min = isset($zbp->option['ZC_USERNAME_MIN']) ? (int) $zbp->option['ZC_USERNAME_MIN'] : 3;
    $max = isset($zbp->option['ZC_USERNAME_MAX']) ? (int) $zbp->option['ZC_USERNAME_MAX'] : 50;
    if (strlen($base) < $min) {
        $base = 'oauth_' . substr(hash('sha256', $provider->Slug . '|' . $subject), 0, 12);
    }
    if (strlen($base) > $max) {
        $base = substr($base, 0, $max);
    }
    $name = $base;
    $index = 1;
    while ($zbp->GetMemberByName($name)->ID > 0) {
        $suffix = '_' . $index;
        $name = substr($base, 0, max(1, $max - strlen($suffix))) . $suffix;
        $index++;
    }
    $nameValue = stotp_oauth_path($profile, $provider->NameField !== '' ? $provider->NameField : 'name');
    $display = $nameValue === null ? '' : trim((string) $nameValue);
    if ($display === '' && isset($profile['preferred_username'])) {
        $display = trim((string) $profile['preferred_username']);
    }
    $member->Name = $name;
    $member->Email = $email;
    $member->Alias = $display !== '' ? substr(strip_tags($display), 0, 50) : $name;
    $member->Password = Member::GetPassWordByGuid(bin2hex(random_bytes(24)), $member->Guid);
    $member->Level = max(2, min(6, (int) stotp_oauth_config('default_level', 5)));
    $member->IP = GetGuestIP();
    $member->PostTime = time();
    $member->Save();

    return $member;
}
