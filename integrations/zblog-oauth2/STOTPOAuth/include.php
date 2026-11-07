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
    $providers = stotp_oauth_providers(true);
    if (count($providers) === 0) {
        return;
    }
    $items = array();
    foreach ($providers as $provider) {
        $items[] = array(
            'name' => $provider->Name,
            'icon' => $provider->Icon,
            'url' => rtrim($zbp->host, '/') . '/zb_users/plugin/STOTPOAuth/oauth2.php?action=start&provider=' . rawurlencode($provider->Slug),
        );
    }
    $json = json_encode($items, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT | JSON_UNESCAPED_UNICODE);
    echo <<<HTML
<style>
.stotp-oauth-login{margin-top:14px;padding-top:12px;border-top:1px solid #e5e5e5;text-align:center}
.stotp-oauth-buttons{display:flex;flex-direction:column;gap:8px}
.stotp-oauth-button{display:flex;align-items:center;justify-content:center;gap:8px;box-sizing:border-box;width:100%;padding:9px 12px;border:1px solid #d2d2d7;border-radius:6px;color:#1d1d1f;text-decoration:none;font-size:14px;background:#fff}
.stotp-oauth-button:hover{border-color:#0071e3;color:#0071e3;text-decoration:none}
.stotp-oauth-icon{width:20px;height:20px;border-radius:5px;object-fit:cover;display:grid;place-items:center;background:#0071e3;color:#fff;font-size:11px;font-weight:700;flex:none}
</style>
<script>
(function(){
  var providers={$json};
  function add(){
    var form=document.querySelector('.login form');
    if(!form||document.querySelector('.stotp-oauth-login')){return;}
    var box=document.createElement('div');
    box.className='stotp-oauth-login';
    var list=document.createElement('div');
    list.className='stotp-oauth-buttons';
    providers.forEach(function(provider){
      var link=document.createElement('a');
      link.className='stotp-oauth-button';
      link.href=provider.url;
      if(provider.icon){
        var img=document.createElement('img');
        img.className='stotp-oauth-icon';
        img.src=provider.icon;
        img.alt='';
        link.appendChild(img);
      }else{
        var mark=document.createElement('span');
        mark.className='stotp-oauth-icon';
        mark.textContent=(provider.name||'O').substring(0,1).toUpperCase();
        link.appendChild(mark);
      }
      var label=document.createElement('span');
      label.textContent=provider.name;
      link.appendChild(label);
      list.appendChild(link);
    });
    box.appendChild(list);
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
    if (!isset($config->auto_register)) {
        $config->auto_register = 1;
        $config->allow_email_link = 1;
        $config->default_level = 5;
        $config->login_redirect = '';
        $config->button_text = '使用 STOTP 登录';
        $config->authorization_url = 'https://auth.yxzhou.com/api/oauth/authorize';
        $config->token_url = 'https://auth.yxzhou.com/api/oauth/token';
        $config->userinfo_url = 'https://auth.yxzhou.com/api/oauth/userinfo';
        $config->scope = 'openid profile email';
        $config->client_id = '';
        $config->client_secret = '';
        $zbp->SaveConfig('STOTPOAuth');
    }
    stotp_oauth_create_table();
    stotp_oauth_migrate_legacy();
}

function UpdatePlugin_STOTPOAuth()
{
    stotp_oauth_create_table();
    stotp_oauth_migrate_legacy();
}

function UninstallPlugin_STOTPOAuth()
{
    // 保留 Provider、绑定与全局配置，便于重新启用；需要彻底删除时手动清表。
}
