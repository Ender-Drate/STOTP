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
if (($_GET['action'] ?? '') === 'bind') {
    stotp_oauth_bind();
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
            CURLOPT_USERAGENT => 'STOTPOAuth/1.2 Z-BlogPHP',
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

function stotp_oauth_authorize_url($provider, $state, $verifier)
{
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

    return $provider->AuthURL . $separator . http_build_query($params, '', '&', PHP_QUERY_RFC3986);
}

function stotp_oauth_start()
{
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
    stotp_oauth_session_start();
    $_SESSION['STOTPOAuth_state'] = array(
        'state' => $state,
        'verifier' => $verifier,
        'provider_id' => (int) $provider->ID,
        'created' => time(),
    );
    $authorizeUrl = stotp_oauth_authorize_url($provider, $state, $verifier);
    if (isset($_GET['passkey'])) {
        $passkeyProvider = stotp_oauth_passkey_provider();
        if (!$passkeyProvider || (int) $passkeyProvider->ID !== (int) $provider->ID) {
            stotp_oauth_fail('当前 Provider 未启用 Passkey 登录。');
        }
        $loginUrl = stotp_oauth_passkey_login_url($provider);
        if ($loginUrl === '') {
            stotp_oauth_fail('未配置 Passkey 登录入口。');
        }
        $separator = strpos($loginUrl, '?') === false ? '?' : '&';
        $authorizePath = parse_url($authorizeUrl, PHP_URL_PATH);
        $authorizeQuery = parse_url($authorizeUrl, PHP_URL_QUERY);
        $relativeAuthorize = ($authorizePath ?: '/api/oauth/authorize')
            . ($authorizeQuery ? '?' . $authorizeQuery : '');
        Redirect($loginUrl . $separator . http_build_query(
            array('next' => $relativeAuthorize, 'method' => 'passkey'),
            '',
            '&',
            PHP_QUERY_RFC3986
        ));
    }
    Redirect($authorizeUrl);
}

function stotp_oauth_bind()
{
    $pending = stotp_oauth_pending();
    if (!$pending) {
        stotp_oauth_fail('绑定会话已过期，请重新发起第三方登录。');
    }
    $provider = stotp_oauth_provider_by_id((int) $pending['provider_id']);
    if (!$provider || !(int) $provider->Enabled) {
        stotp_oauth_fail('OAuth2 Provider 不存在或已停用。');
    }
    $error = '';
    if ($_SERVER['REQUEST_METHOD'] === 'POST') {
        $pending['attempts'] = (int) ($pending['attempts'] ?? 0) + 1;
        $_SESSION['STOTPOAuth_pending'] = $pending;
        if ($pending['attempts'] > 8) {
            unset($_SESSION['STOTPOAuth_pending']);
            stotp_oauth_fail('绑定尝试次数过多，请重新发起第三方登录。', 429);
        }
        $token = isset($_POST['bind_token']) ? (string) $_POST['bind_token'] : '';
        if ($token === '' || !hash_equals((string) $pending['token'], $token)) {
            $error = '绑定请求已失效，请重新发起第三方登录。';
        } else {
            $username = trim((string) ($_POST['username'] ?? ''));
            $password = (string) ($_POST['password'] ?? '');
            if ($username === '' || $password === '') {
                $error = '请输入本地用户名和密码。';
            } else {
                $member = null;
                global $zbp;
                if (!$zbp->Verify_Original($username, $password, $member)
                    || !$member || (int) $member->ID <= 0) {
                    $error = '本地用户名或密码不正确。';
                } elseif ((int) $member->Status !== 0) {
                    $error = '本地账号已被禁用。';
                } else {
                    $existing = stotp_oauth_find_link((int) $provider->ID, (string) $pending['subject']);
                    if ($existing && (int) $existing->MemberID !== (int) $member->ID) {
                        $error = '该第三方身份已经绑定到另一个本地账号。';
                    } else {
                        if (!$existing) {
                            stotp_oauth_save_link(
                                (int) $provider->ID,
                                (int) $member->ID,
                                (string) $pending['subject'],
                                (string) $pending['email']
                            );
                        }
                        stotp_oauth_session_start();
                        unset($_SESSION['STOTPOAuth_pending']);
                        stotp_oauth_member_login($member);
                    }
                }
            }
        }
    }
    stotp_oauth_bind_page($provider, $pending, $error);
}

function stotp_oauth_bind_page($provider, $pending, $error = '')
{
    global $zbp;
    $h = function ($value) {
        return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
    };
    $action = $h(stotp_oauth_callback_url() . '?action=bind');
    $loginUrl = $h(rtrim($zbp->host, '/') . '/zb_system/login.php');
    $providerName = $h($provider->Name);
    $errorHtml = $error === '' ? '' : '<div class="stotp-bind-error">' . $h($error) . '</div>';
    $token = $h($pending['token']);
    echo <<<HTML
<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow">
<title>绑定本地账号</title>
<style>
body{margin:0;background:#f5f6f8;color:#1d1d1f;font:14px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
main{max-width:420px;margin:12vh auto;padding:0 20px}
.card{background:#fff;border:1px solid #e2e4e8;border-radius:14px;padding:26px;box-shadow:0 12px 34px -26px rgba(20,30,50,.35)}
h1{font-size:21px;margin:0 0 8px}p{color:#666;margin:0 0 18px}
label{display:block;color:#555;font-size:12px;margin:12px 0 5px}
input{box-sizing:border-box;width:100%;height:38px;padding:0 10px;border:1px solid #cfd4dc;border-radius:8px;font:inherit}
button{width:100%;height:38px;margin-top:18px;border:1px solid #0a7be8;border-radius:8px;background:#0a7be8;color:#fff;font:inherit;cursor:pointer}
a{color:#0a6fd8;text-decoration:none}.hint{font-size:12px;color:#777;margin-top:14px;text-align:center}
.stotp-bind-error{margin-bottom:14px;padding:9px 11px;border-radius:8px;background:#fff0ef;color:#c0392b;font-size:13px}
</style>
</head>
<body>
<main>
  <div class="card">
    <h1>绑定本地账号</h1>
    <p>使用 <strong>{$providerName}</strong> 首次登录，需要绑定已有的 Z-Blog 账号。不会根据邮箱自动匹配账号。</p>
    {$errorHtml}
    <form method="post" action="{$action}">
      <input type="hidden" name="bind_token" value="{$token}">
      <label for="stotp-bind-username">本地用户名</label>
      <input id="stotp-bind-username" name="username" autocomplete="username" required autofocus>
      <label for="stotp-bind-password">本地密码</label>
      <input id="stotp-bind-password" type="password" name="password" autocomplete="current-password" required>
      <button type="submit">绑定并登录</button>
    </form>
    <div class="hint">还没有本地账号？<a href="{$loginUrl}">先登录/注册 Z-Blog</a>，再重新发起第三方登录。</div>
  </div>
</main>
</body>
</html>
HTML;
    exit;
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

    $member = null;
    $link = stotp_oauth_find_link((int) $provider->ID, $subject);
    if ($link && (int) $link->MemberID > 0) {
        $member = $zbp->GetMemberByID((int) $link->MemberID);
        if (!$member || (int) $member->ID <= 0) {
            stotp_oauth_fail('绑定的本地账号不存在，请联系管理员。');
        }
    }

    // 绝不按邮箱匹配本地账号。未绑定的 subject 必须进入显式绑定页。
    if (!$member) {
        stotp_oauth_begin_binding($provider, $subject, $email, $profile);
    }

    stotp_oauth_member_login($member);
}
