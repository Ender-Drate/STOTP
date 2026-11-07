<?php
require_once __DIR__ . '/common.php';

RegisterPlugin('STOTPOAuth', 'ActivePlugin_STOTPOAuth');

function ActivePlugin_STOTPOAuth()
{
    Add_Filter_Plugin('Filter_Plugin_Login_Header', 'STOTPOAuth_LoginHeader');
}

function STOTPOAuth_LoginHeader()
{
    global $zbp;
    if (!$zbp->CheckPlugin('STOTPOAuth')) {
        return;
    }
    $clientId = stotp_oauth_config('client_id');
    if ($clientId === '') {
        return;
    }
    $start = rtrim($zbp->host, '/') . '/zb_users/plugin/STOTPOAuth/oauth2.php?action=start';
    $label = stotp_oauth_config('button_text', '使用 STOTP 登录');
    $jsStart = json_encode($start, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
    $jsLabel = json_encode($label, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_UNICODE);
    echo <<<HTML
<style>
.stotp-oauth-login{margin-top:14px;padding-top:12px;border-top:1px solid #e5e5e5;text-align:center}
.stotp-oauth-button{display:block;box-sizing:border-box;width:100%;padding:10px 12px;border:1px solid #0071e3;border-radius:6px;color:#0071e3;text-decoration:none;font-size:14px}
.stotp-oauth-button:hover{background:#0071e3;color:#fff;text-decoration:none}
</style>
<script>
(function(){
  function add(){
    var form=document.querySelector('.login form');
    if(!form||document.querySelector('.stotp-oauth-login')){return;}
    var box=document.createElement('div');
    box.className='stotp-oauth-login';
    var link=document.createElement('a');
    link.className='stotp-oauth-button';
    link.href={$jsStart};
    link.textContent={$jsLabel};
    box.appendChild(link);
    form.appendChild(box);
  }
  if(document.readyState==='loading'){document.addEventListener('DOMContentLoaded',add);}else{add();}
})();
</script>
HTML;
}

function InstallPlugin_STOTPOAuth()
{
    global $zbp;
    $config = $zbp->Config('STOTPOAuth');
    if (!isset($config->authorization_url) || $config->authorization_url === '') {
        $config->authorization_url = 'https://auth.yxzhou.com/api/oauth/authorize';
        $config->token_url = 'https://auth.yxzhou.com/api/oauth/token';
        $config->userinfo_url = 'https://auth.yxzhou.com/api/oauth/userinfo';
        $config->scope = 'openid profile email';
        $config->button_text = '使用 STOTP 登录';
        $config->auto_register = 1;
        $config->allow_email_link = 1;
        $config->default_level = 5;
        $config->client_id = '';
        $config->client_secret = '';
        $config->login_redirect = '';
        $zbp->SaveConfig('STOTPOAuth');
    }
    stotp_oauth_create_table();
}

function UpdatePlugin_STOTPOAuth()
{
    stotp_oauth_create_table();
}

function UninstallPlugin_STOTPOAuth()
{
    // 保留绑定表和配置，便于重新启用；需要彻底删除时手动处理。
}
