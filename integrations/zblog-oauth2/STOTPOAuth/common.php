<?php
/**
 * Z-BlogPHP 通用 OAuth2 登录插件。
 *
 * 一个插件内可配置多个 OAuth2 / OIDC Provider。
 */

if (!defined('ZBP_PATH')) {
    exit('Access denied');
}

$GLOBALS['STOTPOAuth_ProviderTable'] = '%pre%oauth2_providers';
$GLOBALS['STOTPOAuth_ProviderDataInfo'] = array(
    'ID' => array('provider_ID', 'integer', '', 0),
    'Slug' => array('provider_Slug', 'string', 50, ''),
    'Name' => array('provider_Name', 'string', 100, ''),
    'Icon' => array('provider_Icon', 'string', 500, ''),
    'AuthURL' => array('provider_AuthURL', 'string', 500, ''),
    'TokenURL' => array('provider_TokenURL', 'string', 500, ''),
    'UserInfoURL' => array('provider_UserInfoURL', 'string', 500, ''),
    'ClientID' => array('provider_ClientID', 'string', 250, ''),
    'ClientSecret' => array('provider_ClientSecret', 'string', 500, ''),
    'Scopes' => array('provider_Scopes', 'string', 250, 'openid profile email'),
    'TokenAuth' => array('provider_TokenAuth', 'string', 10, 'post'),
    'PKCE' => array('provider_PKCE', 'boolean', '', 1),
    'UserInfoMethod' => array('provider_UserInfoMethod', 'string', 10, 'GET'),
    'Extra' => array('provider_Extra', 'string', 500, ''),
    'SubjectField' => array('provider_SubjectField', 'string', 100, 'sub'),
    'EmailField' => array('provider_EmailField', 'string', 100, 'email'),
    'NameField' => array('provider_NameField', 'string', 100, 'name'),
    'VerifiedField' => array('provider_VerifiedField', 'string', 100, 'email_verified'),
    'TrustEmail' => array('provider_TrustEmail', 'boolean', '', 0),
    'Enabled' => array('provider_Enabled', 'boolean', '', 1),
    'Sort' => array('provider_Sort', 'integer', '', 0),
    'Created' => array('provider_Created', 'integer', '', 0),
);

$GLOBALS['STOTPOAuth_LinkTable'] = '%pre%oauth2_links';
$GLOBALS['STOTPOAuth_LinkDataInfo'] = array(
    'ID' => array('link_ID', 'integer', '', 0),
    'ProviderID' => array('link_ProviderID', 'integer', '', 0),
    'MemberID' => array('link_MemberID', 'integer', '', 0),
    'SubjectHash' => array('link_SubjectHash', 'string', 64, ''),
    'Subject' => array('link_Subject', 'string', 191, ''),
    'Email' => array('link_Email', 'string', 250, ''),
    'Created' => array('link_Created', 'integer', '', 0),
);

function stotp_oauth_config($key, $default = '')
{
    global $zbp;
    $config = $zbp->Config('STOTPOAuth');
    if (isset($config->{$key}) && $config->{$key} !== '') {
        return $config->{$key};
    }

    return $default;
}

function stotp_oauth_callback_url()
{
    global $zbp;

    return rtrim($zbp->host, '/') . '/zb_users/plugin/STOTPOAuth/oauth2.php';
}

function stotp_oauth_create_table()
{
    global $zbp;
    foreach (array(
        array($GLOBALS['STOTPOAuth_ProviderTable'], $GLOBALS['STOTPOAuth_ProviderDataInfo']),
        array($GLOBALS['STOTPOAuth_LinkTable'], $GLOBALS['STOTPOAuth_LinkDataInfo']),
    ) as $item) {
        $table = $item[0];
        $tableName = $zbp->db->sql->ReplacePre($table);
        if ($zbp->db->ExistTable($tableName)) {
            continue;
        }
        $sql = $zbp->db->sql->CreateTable($table, $item[1]);
        $zbp->db->QueryMulti($sql);
    }
}

function stotp_oauth_providers($enabledOnly = false)
{
    global $zbp;
    $where = $enabledOnly ? array(array('=', 'provider_Enabled', 1)) : null;
    $sql = $zbp->db->sql->Select(
        $GLOBALS['STOTPOAuth_ProviderTable'],
        '*',
        $where,
        'provider_Sort ASC, provider_ID ASC',
        null,
        null
    );

    return $zbp->GetListCustom(
        $GLOBALS['STOTPOAuth_ProviderTable'],
        $GLOBALS['STOTPOAuth_ProviderDataInfo'],
        $sql
    );
}

function stotp_oauth_provider_by_slug($slug)
{
    global $zbp;
    $sql = $zbp->db->sql->Select(
        $GLOBALS['STOTPOAuth_ProviderTable'],
        '*',
        array(array('=', 'provider_Slug', (string) $slug)),
        null,
        1,
        null
    );
    $list = $zbp->GetListCustom(
        $GLOBALS['STOTPOAuth_ProviderTable'],
        $GLOBALS['STOTPOAuth_ProviderDataInfo'],
        $sql
    );

    return count($list) > 0 ? $list[0] : null;
}

function stotp_oauth_provider_by_id($id)
{
    global $zbp;
    $sql = $zbp->db->sql->Select(
        $GLOBALS['STOTPOAuth_ProviderTable'],
        '*',
        array(array('=', 'provider_ID', (int) $id)),
        null,
        1,
        null
    );
    $list = $zbp->GetListCustom(
        $GLOBALS['STOTPOAuth_ProviderTable'],
        $GLOBALS['STOTPOAuth_ProviderDataInfo'],
        $sql
    );

    return count($list) > 0 ? $list[0] : null;
}

function stotp_oauth_save_provider($data, $id = 0)
{
    global $zbp;
    $values = array();
    $map = array(
        'Slug' => 'provider_Slug',
        'Name' => 'provider_Name',
        'Icon' => 'provider_Icon',
        'AuthURL' => 'provider_AuthURL',
        'TokenURL' => 'provider_TokenURL',
        'UserInfoURL' => 'provider_UserInfoURL',
        'ClientID' => 'provider_ClientID',
        'ClientSecret' => 'provider_ClientSecret',
        'Scopes' => 'provider_Scopes',
        'TokenAuth' => 'provider_TokenAuth',
        'PKCE' => 'provider_PKCE',
        'UserInfoMethod' => 'provider_UserInfoMethod',
        'Extra' => 'provider_Extra',
        'SubjectField' => 'provider_SubjectField',
        'EmailField' => 'provider_EmailField',
        'NameField' => 'provider_NameField',
        'VerifiedField' => 'provider_VerifiedField',
        'TrustEmail' => 'provider_TrustEmail',
        'Enabled' => 'provider_Enabled',
        'Sort' => 'provider_Sort',
    );
    foreach ($map as $key => $column) {
        if (array_key_exists($key, $data)) {
            $values[$column] = $data[$key];
        }
    }
    if ($id > 0) {
        $sql = $zbp->db->sql->Update(
            $GLOBALS['STOTPOAuth_ProviderTable'],
            $values,
            array(array('=', 'provider_ID', (int) $id))
        );
        $zbp->db->Update($sql);

        return (int) $id;
    }
    $values['provider_Created'] = time();
    $sql = $zbp->db->sql->Insert($GLOBALS['STOTPOAuth_ProviderTable'], $values);

    return (int) $zbp->db->Insert($sql);
}

function stotp_oauth_delete_provider($id)
{
    global $zbp;
    $sql = $zbp->db->sql->Delete(
        $GLOBALS['STOTPOAuth_ProviderTable'],
        array(array('=', 'provider_ID', (int) $id))
    );
    $zbp->db->Delete($sql);
    $sql = $zbp->db->sql->Delete(
        $GLOBALS['STOTPOAuth_LinkTable'],
        array(array('=', 'link_ProviderID', (int) $id))
    );
    $zbp->db->Delete($sql);
}

function stotp_oauth_subject_hash($providerId, $subject)
{
    return hash('sha256', 'oauth2|' . (int) $providerId . '|' . $subject);
}

function stotp_oauth_find_link($providerId, $subject)
{
    global $zbp;
    $sql = $zbp->db->sql->Select(
        $GLOBALS['STOTPOAuth_LinkTable'],
        '*',
        array(array('=', 'link_SubjectHash', stotp_oauth_subject_hash($providerId, $subject))),
        null,
        1,
        null
    );
    $list = $zbp->GetListCustom(
        $GLOBALS['STOTPOAuth_LinkTable'],
        $GLOBALS['STOTPOAuth_LinkDataInfo'],
        $sql
    );

    return count($list) > 0 ? $list[0] : null;
}

function stotp_oauth_save_link($providerId, $memberId, $subject, $email)
{
    global $zbp;
    $sql = $zbp->db->sql->Insert($GLOBALS['STOTPOAuth_LinkTable'], array(
        'link_ProviderID' => (int) $providerId,
        'link_MemberID' => (int) $memberId,
        'link_SubjectHash' => stotp_oauth_subject_hash($providerId, $subject),
        'link_Subject' => substr($subject, 0, 191),
        'link_Email' => substr((string) $email, 0, 250),
        'link_Created' => time(),
    ));
    $zbp->db->Insert($sql);
}

function stotp_oauth_migrate_legacy()
{
    global $zbp;
    if (count(stotp_oauth_providers()) > 0) {
        return;
    }
    $clientId = stotp_oauth_config('client_id');
    if ($clientId === '') {
        return;
    }
    stotp_oauth_save_provider(array(
        'Slug' => 'stotp',
        'Name' => 'STOTP',
        'Icon' => '',
        'AuthURL' => stotp_oauth_config('authorization_url'),
        'TokenURL' => stotp_oauth_config('token_url'),
        'UserInfoURL' => stotp_oauth_config('userinfo_url'),
        'ClientID' => $clientId,
        'ClientSecret' => stotp_oauth_config('client_secret'),
        'Scopes' => stotp_oauth_config('scope', 'openid profile email'),
        'TokenAuth' => 'post',
        'PKCE' => 1,
        'UserInfoMethod' => 'GET',
        'Extra' => '',
        'SubjectField' => 'sub',
        'EmailField' => 'email',
        'NameField' => 'name',
        'VerifiedField' => 'email_verified',
        'TrustEmail' => 0,
        'Enabled' => 1,
        'Sort' => 0,
    ));
}

function stotp_oauth_session_start()
{
    if (session_status() === PHP_SESSION_ACTIVE) {
        return;
    }
    $secure = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off');
    session_name('STOTPOAuth');
    if (PHP_VERSION_ID >= 70300) {
        session_set_cookie_params(array(
            'lifetime' => 0,
            'path' => '/',
            'secure' => $secure,
            'httponly' => true,
            'samesite' => 'Lax',
        ));
    } else {
        session_set_cookie_params(0, '/', '', $secure, true);
    }
    session_start();
}

function stotp_oauth_base64url($value)
{
    return rtrim(strtr(base64_encode($value), '+/', '-_'), '=');
}

function stotp_oauth_path($data, $path)
{
    if ($path === '') {
        return null;
    }
    $value = $data;
    foreach (explode('.', $path) as $segment) {
        if (!is_array($value) || !array_key_exists($segment, $value)) {
            return null;
        }
        $value = $value[$segment];
    }

    return $value;
}

function stotp_oauth_fail($message, $status = 400)
{
    http_response_code($status);
    $safe = htmlspecialchars($message, ENT_QUOTES, 'UTF-8');
    echo '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">';
    echo '<meta name="viewport" content="width=device-width,initial-scale=1">';
    echo '<title>OAuth2 登录失败</title></head><body style="font-family:system-ui;padding:40px;max-width:640px;margin:auto">';
    echo '<h1 style="font-size:22px">OAuth2 登录失败</h1><p style="color:#666;line-height:1.7">' . $safe . '</p>';
    echo '<p><a href="' . htmlspecialchars(rtrim($GLOBALS['zbp']->host, '/') . '/zb_system/login.php', ENT_QUOTES, 'UTF-8') . '">返回登录</a></p>';
    echo '</body></html>';
    exit;
}
