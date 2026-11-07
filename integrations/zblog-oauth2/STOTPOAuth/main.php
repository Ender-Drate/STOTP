<?php
require '../../../zb_system/function/c_system_base.php';
require '../../../zb_system/function/c_system_admin.php';

$zbp->Load();
require_once __DIR__ . '/common.php';

$action = 'root';
if (!$zbp->CheckRights($action)) {
    $zbp->ShowError(6);
    die();
}
if (!$zbp->CheckPlugin('STOTPOAuth')) {
    $zbp->ShowError(48);
    die();
}

$blogtitle = 'STOTP OAuth2 登录';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (function_exists('CheckIsRefererValid')) {
        CheckIsRefererValid();
    }
    $fields = array(
        'authorization_url', 'token_url', 'userinfo_url', 'scope',
        'button_text', 'client_id', 'login_redirect',
    );
    foreach ($fields as $field) {
        $value = isset($_POST[$field]) ? trim((string) $_POST[$field]) : '';
        $zbp->Config('STOTPOAuth')->{$field} = $value;
    }
    $secret = isset($_POST['client_secret']) ? trim((string) $_POST['client_secret']) : '';
    if ($secret !== '') {
        $zbp->Config('STOTPOAuth')->client_secret = $secret;
    }
    $level = isset($_POST['default_level']) ? (int) $_POST['default_level'] : 5;
    $zbp->Config('STOTPOAuth')->default_level = max(2, min(6, $level));
    $zbp->Config('STOTPOAuth')->auto_register = isset($_POST['auto_register']) ? 1 : 0;
    $zbp->Config('STOTPOAuth')->allow_email_link = isset($_POST['allow_email_link']) ? 1 : 0;
    $zbp->SaveConfig('STOTPOAuth');
    $zbp->SetHint('good');
    Redirect('./main.php');
}

require $blogpath . 'zb_system/admin/admin_header.php';
require $blogpath . 'zb_system/admin/admin_top.php';

$callback = stotp_oauth_callback_url();
$h = function ($value) {
    return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
};
?>
<div id="divMain">
  <div class="divHeader"><?php echo $blogtitle; ?></div>
  <div id="divMain2">
    <form method="post" action="#">
      <?php if (function_exists('CheckIsRefererValid')) {
          echo '<input type="hidden" name="csrfToken" value="' . $zbp->GetCSRFToken() . '">';
      } ?>
      <table class="tableFull tableBorder">
        <tr>
          <th class="td30">配置</th>
          <th>值</th>
        </tr>
        <tr>
          <td>Authorization URL</td>
          <td><input type="url" name="authorization_url" style="width:90%" value="<?php echo $h(stotp_oauth_config('authorization_url')); ?>"></td>
        </tr>
        <tr>
          <td>Token URL</td>
          <td><input type="url" name="token_url" style="width:90%" value="<?php echo $h(stotp_oauth_config('token_url')); ?>"></td>
        </tr>
        <tr>
          <td>UserInfo URL</td>
          <td><input type="url" name="userinfo_url" style="width:90%" value="<?php echo $h(stotp_oauth_config('userinfo_url')); ?>"></td>
        </tr>
        <tr>
          <td>Client ID</td>
          <td><input type="text" name="client_id" style="width:90%" value="<?php echo $h(stotp_oauth_config('client_id')); ?>"></td>
        </tr>
        <tr>
          <td>Client Secret</td>
          <td>
            <input type="password" name="client_secret" style="width:90%" autocomplete="new-password" placeholder="<?php echo stotp_oauth_config('client_secret') !== '' ? '已保存，留空表示不修改' : '填写 OAuth2 Client Secret'; ?>">
            <p class="note">Secret 只保存在 Z-Blog 的插件配置文件中，不会回显。</p>
          </td>
        </tr>
        <tr>
          <td>Scope</td>
          <td><input type="text" name="scope" style="width:90%" value="<?php echo $h(stotp_oauth_config('scope', 'openid profile email')); ?>"></td>
        </tr>
        <tr>
          <td>按钮文字</td>
          <td><input type="text" name="button_text" style="width:90%" value="<?php echo $h(stotp_oauth_config('button_text', '使用 STOTP 登录')); ?>"></td>
        </tr>
        <tr>
          <td>自动注册</td>
          <td><label><input type="checkbox" name="auto_register" value="1" <?php echo stotp_oauth_config('auto_register', 1) ? 'checked' : ''; ?>> 未绑定用户首次登录时自动创建 Z-Blog 账号</label></td>
        </tr>
        <tr>
          <td>已验证邮箱自动绑定</td>
          <td><label><input type="checkbox" name="allow_email_link" value="1" <?php echo stotp_oauth_config('allow_email_link', 1) ? 'checked' : ''; ?>> 第三方返回 email_verified=true 且邮箱已存在时，绑定到已有账号</label></td>
        </tr>
        <tr>
          <td>默认用户等级</td>
          <td>
            <select name="default_level">
              <?php for ($level = 2; $level <= 6; $level++) {
                  $name = isset($zbp->lang['user_level_name'][$level]) ? $zbp->lang['user_level_name'][$level] : '等级 ' . $level;
                  $selected = (int) stotp_oauth_config('default_level', 5) === $level ? ' selected' : '';
                  echo '<option value="' . $level . '"' . $selected . '>' . $h($name) . '</option>';
              } ?>
            </select>
            <p class="note">建议 5 或 6，不要自动创建管理员。</p>
          </td>
        </tr>
        <tr>
          <td>登录后跳转</td>
          <td><input type="text" name="login_redirect" style="width:90%" value="<?php echo $h(stotp_oauth_config('login_redirect')); ?>" placeholder="留空跳转后台；可填 https://..."></td>
        </tr>
        <tr>
          <td>回调地址</td>
          <td>
            <code><?php echo $h($callback); ?></code>
            <p class="note">必须与 auth-center 中该 OAuth2 Client 的 redirect_uri 完全一致。</p>
          </td>
        </tr>
      </table>
      <p><input type="submit" class="button" value="保存配置"></p>
    </form>
  </div>
</div>
<?php
require $blogpath . 'zb_system/admin/admin_footer.php';
