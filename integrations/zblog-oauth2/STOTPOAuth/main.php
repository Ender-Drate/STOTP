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

$blogtitle = 'OAuth2 通用登录';
$h = function ($value) {
    return htmlspecialchars((string) $value, ENT_QUOTES, 'UTF-8');
};

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    if (function_exists('CheckIsRefererValid')) {
        CheckIsRefererValid();
    }
    $postAction = isset($_POST['action']) ? (string) $_POST['action'] : '';
    if ($postAction === 'delete') {
        stotp_oauth_delete_provider((int) ($_POST['provider_id'] ?? 0));
        $zbp->SetHint('good');
        Redirect('./main.php');
    }
    if ($postAction === 'settings') {
        $zbp->Config('STOTPOAuth')->auto_register = isset($_POST['auto_register']) ? 1 : 0;
        $zbp->Config('STOTPOAuth')->allow_email_link = isset($_POST['allow_email_link']) ? 1 : 0;
        $level = isset($_POST['default_level']) ? (int) $_POST['default_level'] : 5;
        $zbp->Config('STOTPOAuth')->default_level = max(2, min(6, $level));
        $zbp->Config('STOTPOAuth')->login_redirect = trim((string) ($_POST['login_redirect'] ?? ''));
        $zbp->SaveConfig('STOTPOAuth');
        $zbp->SetHint('good');
        Redirect('./main.php');
    }
    if ($postAction === 'provider') {
        $id = (int) ($_POST['provider_id'] ?? 0);
        $existing = $id > 0 ? stotp_oauth_provider_by_id($id) : null;
        if ($id > 0 && !$existing) {
            $zbp->ShowError('Provider 不存在');
        }
        $name = trim((string) ($_POST['name'] ?? ''));
        $slug = strtolower(trim((string) ($_POST['slug'] ?? '')));
        $slug = preg_replace('/[^a-z0-9_-]/', '', $slug);
        if ($name === '' || $slug === '') {
            $zbp->ShowError('Provider 名称和 Slug 不能为空');
        }
        $duplicate = stotp_oauth_provider_by_slug($slug);
        if ($duplicate && (int) $duplicate->ID !== $id) {
            $zbp->ShowError('Slug 已被其他 Provider 使用');
        }
        $authUrl = trim((string) ($_POST['auth_url'] ?? ''));
        $tokenUrl = trim((string) ($_POST['token_url'] ?? ''));
        $userInfoUrl = trim((string) ($_POST['userinfo_url'] ?? ''));
        foreach (array($authUrl, $tokenUrl, $userInfoUrl) as $url) {
            if (!filter_var($url, FILTER_VALIDATE_URL)
                || !preg_match('#^https?://#i', $url)) {
                $zbp->ShowError('Authorization / Token / UserInfo 必须是 http(s) URL');
            }
        }
        $clientId = trim((string) ($_POST['client_id'] ?? ''));
        if ($clientId === '') {
            $zbp->ShowError('Client ID 不能为空');
        }
        $secret = trim((string) ($_POST['client_secret'] ?? ''));
        if ($id > 0 && $secret === '') {
            $secret = (string) $existing->ClientSecret;
        }
        $icon = trim((string) ($_POST['icon'] ?? ''));
        if ($icon !== '' && (!filter_var($icon, FILTER_VALIDATE_URL)
            || !preg_match('#^https?://#i', $icon))) {
            $zbp->ShowError('图标必须是 http(s) URL');
        }
        $tokenAuth = ($_POST['token_auth'] ?? 'post') === 'basic' ? 'basic' : 'post';
        $userInfoMethod = strtoupper((string) ($_POST['userinfo_method'] ?? 'GET')) === 'POST' ? 'POST' : 'GET';
        $subjectField = trim((string) ($_POST['subject_field'] ?? '')) ?: 'sub';
        $emailField = trim((string) ($_POST['email_field'] ?? '')) ?: 'email';
        $nameField = trim((string) ($_POST['name_field'] ?? '')) ?: 'name';
        $verifiedField = trim((string) ($_POST['verified_field'] ?? ''));
        $data = array(
            'Slug' => $slug,
            'Name' => $name,
            'Icon' => $icon,
            'AuthURL' => $authUrl,
            'TokenURL' => $tokenUrl,
            'UserInfoURL' => $userInfoUrl,
            'ClientID' => $clientId,
            'ClientSecret' => $secret,
            'Scopes' => trim((string) ($_POST['scopes'] ?? 'openid profile email')),
            'TokenAuth' => $tokenAuth,
            'PKCE' => isset($_POST['pkce']) ? 1 : 0,
            'UserInfoMethod' => $userInfoMethod,
            'Extra' => trim((string) ($_POST['extra'] ?? '')),
            'SubjectField' => $subjectField,
            'EmailField' => $emailField,
            'NameField' => $nameField,
            'VerifiedField' => $verifiedField,
            'TrustEmail' => isset($_POST['trust_email']) ? 1 : 0,
            'Enabled' => isset($_POST['enabled']) ? 1 : 0,
            'Sort' => (int) ($_POST['sort'] ?? 0),
        );
        $savedId = stotp_oauth_save_provider($data, $id);
        $zbp->SetHint('good');
        Redirect('./main.php?edit=' . $savedId);
    }
}

$editId = isset($_GET['edit']) ? (int) $_GET['edit'] : 0;
$isNew = isset($_GET['new']);
$editProvider = $editId > 0 ? stotp_oauth_provider_by_id($editId) : null;
$providers = stotp_oauth_providers(false);
$callback = stotp_oauth_callback_url();

require $blogpath . 'zb_system/admin/admin_header.php';
require $blogpath . 'zb_system/admin/admin_top.php';
?>
<div id="divMain">
  <div class="divHeader"><?php echo $blogtitle; ?></div>
  <div id="divMain2">
    <p style="color:#666;line-height:1.7">
      这里的每个 Provider 都会在 Z-Blog 登录页生成一个按钮。回调地址对所有 Provider 相同：
      <code><?php echo $h($callback); ?></code>
    </p>

    <table class="tableFull tableBorder">
      <tr>
        <th>名称</th><th>Slug</th><th>端点</th><th>排序</th><th>状态</th><th>操作</th>
      </tr>
      <?php foreach ($providers as $provider) { ?>
        <tr>
          <td><?php echo $h($provider->Name); ?></td>
          <td><code><?php echo $h($provider->Slug); ?></code></td>
          <td class="note"><?php echo $h($provider->AuthURL); ?></td>
          <td><?php echo (int) $provider->Sort; ?></td>
          <td><?php echo (int) $provider->Enabled ? '启用' : '停用'; ?></td>
          <td>
            <a class="button" href="./main.php?edit=<?php echo (int) $provider->ID; ?>">编辑</a>
            <form method="post" action="./main.php" style="display:inline" onsubmit="return confirm('删除该 Provider 及其绑定？');">
              <input type="hidden" name="action" value="delete">
              <input type="hidden" name="provider_id" value="<?php echo (int) $provider->ID; ?>">
              <?php if (function_exists('CheckIsRefererValid')) {
                  echo '<input type="hidden" name="csrfToken" value="' . $zbp->GetCSRFToken() . '">';
              } ?>
              <input type="submit" class="button" value="删除">
            </form>
          </td>
        </tr>
      <?php } ?>
      <?php if (count($providers) === 0) { ?>
        <tr><td colspan="6" class="note">还没有 OAuth2 Provider，点击「添加 Provider」。</td></tr>
      <?php } ?>
    </table>

    <p><a class="button" href="./main.php?new=1">添加 Provider</a></p>

    <?php if ($isNew || $editProvider) {
        $p = $editProvider;
        $value = function ($key, $default = '') use ($p) {
            return $p && $p->{$key} !== '' ? $p->{$key} : $default;
        };
    ?>
      <form method="post" action="./main.php" style="margin-top:20px">
        <input type="hidden" name="action" value="provider">
        <input type="hidden" name="provider_id" value="<?php echo $p ? (int) $p->ID : 0; ?>">
        <?php if (function_exists('CheckIsRefererValid')) {
            echo '<input type="hidden" name="csrfToken" value="' . $zbp->GetCSRFToken() . '">';
        } ?>
        <table class="tableFull tableBorder">
          <tr><th class="td30">字段</th><th>值</th></tr>
          <tr><td>名称</td><td><input type="text" name="name" style="width:90%" value="<?php echo $h($value('Name')); ?>" required></td></tr>
          <tr><td>Slug</td><td><input type="text" name="slug" style="width:90%" value="<?php echo $h($value('Slug')); ?>" pattern="[a-z0-9_-]+" required><p class="note">用于回调和按钮，仅小写字母数字 _ -，例如 github、google。</p></td></tr>
          <tr><td>图标 URL（可选）</td><td><input type="url" name="icon" style="width:90%" value="<?php echo $h($value('Icon')); ?>" placeholder="https://.../logo.png"></td></tr>
          <tr><td>Authorization URL</td><td><input type="url" name="auth_url" style="width:90%" value="<?php echo $h($value('AuthURL')); ?>" placeholder="https://github.com/login/oauth/authorize" required></td></tr>
          <tr><td>Token URL</td><td><input type="url" name="token_url" style="width:90%" value="<?php echo $h($value('TokenURL')); ?>" placeholder="https://github.com/login/oauth/access_token" required></td></tr>
          <tr><td>UserInfo URL</td><td><input type="url" name="userinfo_url" style="width:90%" value="<?php echo $h($value('UserInfoURL')); ?>" placeholder="https://api.github.com/user" required></td></tr>
          <tr><td>Client ID</td><td><input type="text" name="client_id" style="width:90%" value="<?php echo $h($value('ClientID')); ?>" required></td></tr>
          <tr><td>Client Secret</td><td><input type="password" name="client_secret" style="width:90%" autocomplete="new-password" placeholder="<?php echo $p && $p->ClientSecret !== '' ? '已保存，留空表示不修改' : '公共客户端可留空，机密客户端必填'; ?>"><p class="note">只保存在 Z-Blog 插件配置中，不回显。</p></td></tr>
          <tr><td>Scope</td><td><input type="text" name="scopes" style="width:90%" value="<?php echo $h($value('Scopes', 'openid profile email')); ?>"></td></tr>
          <tr><td>Token 认证</td><td><select name="token_auth"><option value="post" <?php echo $value('TokenAuth', 'post') === 'post' ? 'selected' : ''; ?>>client_secret_post</option><option value="basic" <?php echo $value('TokenAuth') === 'basic' ? 'selected' : ''; ?>>client_secret_basic</option></select></td></tr>
          <tr><td>UserInfo 方法</td><td><select name="userinfo_method"><option value="GET" <?php echo strtoupper($value('UserInfoMethod', 'GET')) === 'GET' ? 'selected' : ''; ?>>GET</option><option value="POST" <?php echo strtoupper($value('UserInfoMethod')) === 'POST' ? 'selected' : ''; ?>>POST</option></select></td></tr>
          <tr><td>PKCE</td><td><label><input type="checkbox" name="pkce" value="1" <?php echo $value('PKCE', 1) ? 'checked' : ''; ?>> 发送 code_challenge（S256）</label></td></tr>
          <tr><td>额外授权参数</td><td><input type="text" name="extra" style="width:90%" value="<?php echo $h($value('Extra')); ?>" placeholder="prompt=consent&access_type=offline"></td></tr>
          <tr><td>Subject 字段</td><td><input type="text" name="subject_field" style="width:90%" value="<?php echo $h($value('SubjectField', 'sub')); ?>"><p class="note">支持点路径，如 data.id；GitHub 用 id，OIDC 用 sub。</p></td></tr>
          <tr><td>Email 字段</td><td><input type="text" name="email_field" style="width:90%" value="<?php echo $h($value('EmailField', 'email')); ?>"></td></tr>
          <tr><td>Name 字段</td><td><input type="text" name="name_field" style="width:90%" value="<?php echo $h($value('NameField', 'name')); ?>"></td></tr>
          <tr><td>Email Verified 字段</td><td><input type="text" name="verified_field" style="width:90%" value="<?php echo $h($value('VerifiedField', 'email_verified')); ?>"><p class="note">留空表示该 Provider 不返回验证字段；此时只有勾选「信任邮箱」才自动注册/绑定。</p></td></tr>
          <tr><td>信任邮箱</td><td><label><input type="checkbox" name="trust_email" value="1" <?php echo $value('TrustEmail') ? 'checked' : ''; ?>> Provider 返回的邮箱视为已验证（仅用于不支持 email_verified 的服务）</label></td></tr>
          <tr><td>排序</td><td><input type="number" name="sort" value="<?php echo (int) $value('Sort', 0); ?>"></td></tr>
          <tr><td>启用</td><td><label><input type="checkbox" name="enabled" value="1" <?php echo $value('Enabled', 1) ? 'checked' : ''; ?>> 在登录页显示</label></td></tr>
        </table>
        <p><input type="submit" class="button" value="保存 Provider"></p>
      </form>
    <?php } ?>

    <form method="post" action="./main.php" style="margin-top:24px">
      <input type="hidden" name="action" value="settings">
      <?php if (function_exists('CheckIsRefererValid')) {
          echo '<input type="hidden" name="csrfToken" value="' . $zbp->GetCSRFToken() . '">';
      } ?>
      <table class="tableFull tableBorder">
        <tr><th colspan="2">全局设置</th></tr>
        <tr><td>自动注册</td><td><label><input type="checkbox" name="auto_register" value="1" <?php echo stotp_oauth_config('auto_register', 1) ? 'checked' : ''; ?>> 未绑定用户首次登录时创建 Z-Blog 账号</label></td></tr>
        <tr><td>已验证邮箱自动绑定</td><td><label><input type="checkbox" name="allow_email_link" value="1" <?php echo stotp_oauth_config('allow_email_link', 1) ? 'checked' : ''; ?>> 邮箱已验证且本地存在时绑定已有账号</label></td></tr>
        <tr><td>默认用户等级</td><td><select name="default_level"><?php for ($level = 2; $level <= 6; $level++) {
            $label = isset($zbp->lang['user_level_name'][$level]) ? $zbp->lang['user_level_name'][$level] : '等级 ' . $level;
            echo '<option value="' . $level . '"' . ((int) stotp_oauth_config('default_level', 5) === $level ? ' selected' : '') . '>' . $h($label) . '</option>';
        } ?></select></td></tr>
        <tr><td>登录后跳转</td><td><input type="text" name="login_redirect" style="width:90%" value="<?php echo $h(stotp_oauth_config('login_redirect')); ?>" placeholder="留空跳转后台；可填 https://..."></td></tr>
      </table>
      <p><input type="submit" class="button" value="保存全局设置"></p>
    </form>
  </div>
</div>
<?php
require $blogpath . 'zb_system/admin/admin_footer.php';
