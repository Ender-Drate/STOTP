<?php
/**
 * Z-BlogPHP OAuth2 登录插件。
 *
 * 接入 auth-center 的 OIDC / OAuth2 授权码 + PKCE。
 */

if (!defined('ZBP_PATH')) {
    exit('Access denied');
}

$GLOBALS['STOTPOAuth_Table'] = '%pre%stotp_oauth_links';
$GLOBALS['STOTPOAuth_DataInfo'] = array(
    'ID' => array('link_ID', 'integer', '', 0),
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
    $table = $GLOBALS['STOTPOAuth_Table'];
    $tableName = $zbp->db->sql->ReplacePre($table);
    if ($zbp->db->ExistTable($tableName)) {
        return;
    }
    $sql = $zbp->db->sql->CreateTable($table, $GLOBALS['STOTPOAuth_DataInfo']);
    $zbp->db->QueryMulti($sql);
}

function stotp_oauth_subject_hash($subject)
{
    return hash('sha256', stotp_oauth_config('client_id') . '|' . $subject);
}

function stotp_oauth_find_link($subject)
{
    global $zbp;
    $sql = $zbp->db->sql->Select(
        $GLOBALS['STOTPOAuth_Table'],
        '*',
        array(array('=', 'link_SubjectHash', stotp_oauth_subject_hash($subject))),
        null,
        1,
        null
    );
    $list = $zbp->GetListCustom(
        $GLOBALS['STOTPOAuth_Table'],
        $GLOBALS['STOTPOAuth_DataInfo'],
        $sql
    );

    return count($list) > 0 ? $list[0] : null;
}

function stotp_oauth_save_link($memberId, $subject, $email)
{
    global $zbp;
    $sql = $zbp->db->sql->Insert($GLOBALS['STOTPOAuth_Table'], array(
        'link_MemberID' => (int) $memberId,
        'link_SubjectHash' => stotp_oauth_subject_hash($subject),
        'link_Subject' => substr($subject, 0, 191),
        'link_Email' => substr((string) $email, 0, 250),
        'link_Created' => time(),
    ));
    $zbp->db->Insert($sql);
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
