/* eslint-disable */
/**
 * dsh-ops-console — browser half.
 *
 * A local operations console page for DeepSeek Harness: website monitoring,
 * SSH servers, GitHub and Cloudflare. The Host half owns the two API routes:
 *   GET  /api/ops-console/snapshot
 *   POST /api/ops-console/action
 *
 * This file is a plain browser module: no JSX, no build step, no imports
 * beyond React supplied by the shell. All CSS lives in one injected
 * <style data-plugin="dsh-ops-console"> element.
 */
window.__ModuleLoader__.load({
  id: 'dsh-ops-console',
  factory(require) {
    'use strict';

    var module = { exports: {} };
    var exports = module.exports;
    const React = require('react');
    const { useCallback, useEffect, useMemo, useRef, useState, useReducer } = React;
    const h = React.createElement;

    // =========================================================================
    // Constants
    // =========================================================================

    const PLUGIN_ID = 'dsh-ops-console';
    const PANEL_ID = 'ops-console';
    const API_SNAPSHOT = '/api/ops-console/snapshot';
    const API_ACTION = '/api/ops-console/action';

    const FETCH_TIMEOUT_MS = 15000;
    const POLL_ACTIVE_MS = 2500;
    const POLL_IDLE_MS = 15000;
    const BACKOFF_MAX_MS = 30000;
    const CONFIRM_TIMEOUT_MS = 3000;
    const NOTE_TIMEOUT_MS = 6000;

    const TAB_IDS = ['overview', 'sites', 'servers', 'platforms', 'settings'];
    const INTERVAL_OPTIONS = [5, 10, 15, 30, 60, 120];
    const CN_PROBE_OPTIONS = [1, 2, 3];
    const COUNTRY_OPTIONS = ['US', 'DE', 'JP', 'SG', 'GB', 'AU'];
    const HISTORY_POINTS_DEFAULT = 60;

    const ITDOG_BASE = 'https://www.itdog.cn/http/';
    const GLOBALPING_URL = 'https://www.globalping.io/';

    // =========================================================================
    // Locale dictionary
    // Every visible string is read from here. Missing keys fall back to
    // English and then to the key itself.
    // =========================================================================

    const MESSAGES = {
      zh: {
        panelTitle: '运维台',
        boundary: {
          title: '运维台渲染失败',
          text: '页面遇到了一个前端错误。可以点重试；如果反复出现，请刷新页面或查看浏览器控制台。',
          retry: '重试',
        },
        panelSubtitle: '本机运维控制台：监控网站、SSH 服务器、GitHub 与 Cloudflare。',
        brand: {
          globalping: 'Globalping',
          itdog: 'itdog',
        },
        tabs: {
          label: '运维台分区',
          overview: '总览',
          sites: '网站',
          servers: '服务器',
          platforms: '平台',
          settings: '设置',
        },
        common: {
          checkNow: '立即检测',
          checking: '检测中…',
          close: '关闭',
          collapse: '收起',
          confirmDelete: '确认删除',
          copied: '已复制',
          copy: '复制',
          copyFailed: '复制失败',
          delete: '删除',
          details: '详情',
          disabled: '已停用',
          enabled: '已启用',
          loading: '加载中…',
          name: '名称',
          neverRefreshed: '尚未刷新',
          no: '否',
          none: '—',
          refreshing: '刷新中…',
          remove: '移除',
          retry: '重试',
          status: '状态',
          time: '时间',
          tooLong: '内容过长，已截断',
          unknown: '未知',
          working: '处理中…',
          yes: '是',
        },
        units: {
          days: '天',
          hours: '小时',
          minutes: '分钟',
          ms: 'ms',
        },
        time: {
          justNow: '刚刚',
          soon: '即将',
          inMinutes: '{n} 分钟后',
          minutesAgo: '{n} 分钟前',
          inHours: '{n} 小时后',
          hoursAgo: '{n} 小时前',
          inDays: '{n} 天后',
          daysAgo: '{n} 天前',
        },
        status: {
          up: '正常',
          degraded: '降级',
          down: '异常',
          unknown: '未知',
          online: '在线',
          warning: '警告',
          offline: '离线',
          connected: '已连接',
          'not-installed': '未安装',
          'not-authenticated': '未登录',
          error: '错误',
          checking: '检测中',
          idle: '待检测',
          loading: '加载中',
          ok: '正常',
          completed: '已完成',
          success: '成功',
          failure: '失败',
          timed_out: '超时',
          action_required: '需要处理',
          startup_failure: '启动失败',
          in_progress: '进行中',
          queued: '排队中',
          waiting: '等待中',
          pending: '处理中',
          skipped: '已跳过',
          neutral: '中性',
          cancelled: '已取消',
          valid: '有效',
          invalid: '无效',
        },
        header: {
          lastRefreshLabel: '最近刷新',
          monitorInterval: '每 {n} 分钟',
          monitorOn: '监控开启',
          monitorPaused: '监控已暂停',
          monitorRunning: '正在检测',
          nextRun: '下次检测 {time}',
          refreshAll: '刷新全部',
        },
        banner: {
          actionTitle: '操作失败',
          authHint: '请确认当前 DSH 会话有权限访问运维台接口，然后重试。',
          authMessage: '运维台接口拒绝了本次请求。',
          authTitle: '没有访问权限',
          autoRetry: '稍后会自动重试。',
          loadingFailedText: '无法加载运维台数据。请确认 Host 半部分已启用，然后重试。',
          loadingFailedTitle: '暂时无法加载',
          networkHint: '稍后会自动重试；也可以点击重试立即刷新。',
          networkMessage: '请求 /api/ops-console 失败，可能是 Host 半部分未启用或连接已断开。',
          networkTitle: '无法连接本机运维服务',
          serverMessage: '服务返回了未知错误。',
          timeoutHint: '请检查 Host 端是否正在执行耗时命令。',
          timeoutMessage: '运维服务在 15 秒内没有响应。',
          timeoutTitle: '请求超时',
        },
        overview: {
          attention: '需要关注',
          attentionEmpty: '当前没有需要关注的网站。',
          attentionNoSites: '还没有添加网站，添加后会在这里显示异常项。',
          cloudflareStateHint: '尚未检查 Cloudflare 连接',
          dataSources: '数据来源与运行方式',
          githubStateHint: '尚未检查 GitHub 连接',
          noSitesTitle: '还没有网站',
          sourceGlobalpingText: '提供多国家探测节点；',
          sourceItdogText: '仅作为手动打开的第三方测速链接，不会自动提交；',
          sourceLocal: '本机直连探测',
          sourceLocalText: '补充 DNS、TCP、TLS、TTFB 与重定向细节；',
          sourceRun: '监控运行方式',
          sourceRunText: '监控在 DSH 打开期间于本机运行，关闭 DSH 后暂停。',
          statCloudflare: 'Cloudflare',
          statCloudflareHint: '账号 {name}',
          statCnMedian: 'CN 中位延迟',
          statGithub: 'GitHub',
          statGithubHint: '账号 {login}',
          statGlobalMedian: '海外中位延迟',
          statMedianHint: '已启用网站的中位数',
          statServers: '服务器在线',
          statServersHint: '共 {n} 台',
          statSites: '网站',
          statSitesHint: '正常 {up} · 需关注 {down}',
        },
        sites: {
          addBusy: '添加中…',
          addSubmit: '添加网站',
          addTitle: '添加网站',
          bodyBytes: '响应大小',
          checkAll: '全部检测',
          checkingAll: '检测全部中…',
          cnMedian: 'CN 中位延迟',
          cnNodes: '中国大陆节点',
          copyHost: '复制域名',
          countLabel: '共 {n} 个网站，{up} 个正常，{issue} 个异常',
          daysValue: '{n} 天',
          deleteConfirm: '确认删除？该操作只移除监控项。',
          disabledNote: '已停用：不会自动检测。',
          dns: 'DNS',
          emptyText: '在上方填写名称和网址即可添加。添加后 Host 会自动开始第一次检测；如果没有自动检测，可点击「立即检测」。',
          emptyTitle: '还没有网站',
          failures: '失败节点',
          finalUrl: '最终地址',
          formUrlInvalid: '请输入 http:// 或 https:// 开头的有效网址。',
          formUrlRequired: '请填写网址。',
          globalMedian: '海外中位延迟',
          globalNodes: '海外节点',
          globalError: '探测异常',
          groupError: '探测错误：{message}',
          groupSkipped: '本组探测已跳过',
          groupSummary: '{total} 个节点 · 成功 {success} · 失败 {failed}',
          historyLegendCn: 'CN',
          historyLegendGlobal: '海外',
          historyLegendLocal: '本地',
          historyPoints: '近 {n} 个采样点',
          historyTitle: '延迟历史趋势',
          itdog: '在 itdog 打开',
          lastChecked: '最近检测',
          localMedian: '本地中位延迟',
          localStatus: '状态码',
          localTitle: '本机探测',
          nameLabel: '名称（可选）',
          namePlaceholder: '例如：主站',
          noHistory: '历史数据不足，暂不绘制趋势图。',
          noProbe: '尚未检测，点击「立即检测」开始。',
          nodesEmpty: '没有节点数据。',
          reachable: '可达',
          reasons: '原因',
          redirectTitle: '重定向链',
          redirectsEmpty: '没有重定向。',
          tableCountry: '国家/地区',
          tableLatency: '延迟',
          tableNetwork: '网络',
          tableNode: '节点',
          tableResult: '结果',
          tableStatus: '状态',
          tableStep: '步骤',
          tableUrl: '地址',
          tcp: 'TCP',
          timings: '耗时明细',
          tls: 'TLS',
          tlsDays: 'TLS 剩余',
          tlsIssuer: '签发者',
          tlsProtocol: '协议',
          tlsTitle: 'TLS 证书',
          tlsValid: '证书状态',
          statusHint: '「降级」表示仍能访问，但部分探测节点失败、TLS 证书异常或返回 401/403；「异常」表示本机不可达或返回非预期状态。',
          statusLegend: '状态说明',
          statusUpDesc: '本机 2xx/3xx，国内/海外节点没有失败，TLS 有效。',
          statusDegradedDesc: '网站仍可访问，但部分节点失败、TLS 无效/即将到期，或本机返回 401/403（可能被 WAF/鉴权拦截）。',
          statusDownDesc: '本机不可达，或返回 4xx/5xx 等非预期状态。',
          statusUnknownDesc: '尚未完成检测，或上一次检测被取消。',
          toggleEnabled: '启用状态',
          total: '总计',
          ttfb: '首字节（含连接）',
          unnamed: '未命名网站',
          uptime: '可用率',
          urlLabel: '网址',
          urlPlaceholder: 'https://example.com',
        },
        servers: {
          addBusy: '添加中…',
          addSubmit: '添加服务器',
          addTitle: '添加服务器',
          checkAll: '全部检测',
          checkingAll: '检测全部中…',
          coresHint: '{n} 核',
          countLabel: '共 {n} 台，{online} 台在线',
          deleteConfirm: '确认删除？',
          disk: '磁盘',
          docker: 'Docker 容器',
          dockerValue: '{n} 个',
          duration: '耗时',
          emptyText: '添加 SSH 服务器后即可查看在线状态、负载、内存、磁盘与服务状态。仅支持密钥认证。',
          emptyTitle: '还没有服务器',
          errorTitle: '错误',
          failedUnits: '失败服务',
          failedUnitsHint: '有失败的服务，请检查 systemd',
          failedUnitsValue: '{n} 项',
          formHint: '私钥留空时由 ssh 自己读取 ~/.ssh/config、默认密钥和 ssh-agent；用户留空时使用本机登录用户名（不是默认 root）。macOS 可点「选择文件…」选择。',
          pickKey: '选择文件…',
          pickKeyBusy: '选择中…',
          pickKeyHint: 'macOS 会打开系统文件选择器；其他系统请手动填写路径。',
          copyCommand: '复制',
          keyHelpTitle: '本机 SSH 密钥怎么用',
          keyHelpIntro: '私钥路径留空时，由 ssh 自己使用 ~/.ssh/config、默认密钥（~/.ssh/id_*）和 ssh-agent。插件不读取这些文件，也不保存密码。',
          keyHelpList: '查看 ~/.ssh 目录：',
          keyHelpAgent: '查看 ssh-agent 已加载的密钥：',
          keyHelpConfig: '查看某个目标实际使用的 hostname/user/port/identityFile：',
          keyHelpManage: '把密钥加入 agent（macOS 可加 --apple-use-keychain 存入钥匙串）：',
          keyHelpPermissions: '私钥权限建议 600：',
          keyHelpNote: '如果 ssh-add -l 提示 agent 未启动，先在终端执行 eval "$(ssh-agent -s)"。',
          verifyCommandHint: '在终端运行下面这条命令，确认主机指纹/登录后再点检测：',
          verifyCommand: '终端验证命令',
          hostname: '主机名',
          identityLabel: '私钥路径（可选）',
          identityNote: '私钥：{path}',
          identityPlaceholder: '留空则使用默认密钥或 agent',
          labelLabel: '标签（可选）',
          labelPlaceholder: '例如：东京节点',
          lastChecked: '最近检测',
          load: '负载',
          loadValue: '{l1} / {l5} / {l15}',
          memory: '内存',
          neverChecked: '尚未检测',
          os: '系统',
          portInvalid: '端口必须是 1–65535 的整数。',
          portLabel: '端口（可选）',
          rawEmpty: 'Host 尚未返回原始输出。',
          rawTitle: '原始输出',
          sshHint: '请确认本机可免密 ssh 到目标（密钥或 ssh-agent），再点击检测。',
          targetLabel: '目标',
          targetNote: '{user}@{target}:{port}',
          targetPlaceholder: '主机名或 ssh 别名',
          targetRequired: '请填写目标主机或 ssh 别名。',
          uptime: '运行时间',
          userLabel: '用户',
          userPlaceholder: 'root',
          warnings: '警告',
        },
        platforms: {
          account: '账号',
          accountCount: '{n} 个账号',
          accountId: '账号 ID',
          accounts: '可用账号',
          branch: '分支',
          buildLink: '构建链接',
          cloudflareAddHint: '输入 Cloudflare Pages 项目名；若不确定，先点刷新查看已有项目。',
          cloudflareAddInvalid: '请输入有效的项目名。',
          cloudflareAddLabel: '添加 Pages 项目',
          cloudflareAddPlaceholder: '项目名',
          cloudflareAddSubmit: '添加项目',
          cloudflareTitle: 'Cloudflare',
          connection: '连接状态',
          dashboard: '打开仪表盘',
          discovered: '已发现但未监控的项目',
          discoveredHint: '点击即可添加监控',
          deploymentUrl: '访问地址',
          deployments: '最近部署',
          deploymentsEmpty: '没有部署记录。',
          email: '邮箱',
          environment: '环境',
          gitProvider: 'Git 仓库',
          githubAddHint: '输入 GitHub 仓库的全名，例如 vercel/next.js。',
          githubAddInvalid: '请输入 owner/name 格式的仓库名。',
          githubAddLabel: '添加仓库',
          githubAddPlaceholder: 'owner/name',
          githubAddSubmit: '添加仓库',
          githubRepos: '监控的仓库',
          githubTitle: 'GitHub',
          lastFetched: '最近获取',
          lastModified: '最近修改',
          latestRuns: '最近工作流',
          openPRs: '开启的 PR',
          openPRsCount: '{n} 个',
          openPRsEmpty: '没有开启的 PR。',
          permissions: '权限项',
          permissionsCount: '{n} 项权限',
          projectEmpty: '还没有监控的 Cloudflare Pages 项目。',
          refresh: '刷新',
          refreshing: '刷新中…',
          removeProjectConfirm: '确认移除？',
          removeRepoConfirm: '确认移除？',
          repoEmpty: '还没有监控的仓库。添加 owner/name 后会显示最近运行和 PR。',
          runsEmpty: '没有工作流运行记录。',
          source: '提交',
          version: '版本',
          watchlistEmptyHint: '空列表不会显示假数据；添加监控项后即可查看真实状态。',
          githubNotInstalled: '未检测到 gh CLI。请先安装 GitHub CLI 并登录，然后刷新连接。',
          githubNotInstalledHint: 'brew install gh',
          githubNotAuthenticated: 'gh CLI 已安装但尚未登录。',
          githubNotAuthenticatedHint: 'gh auth login',
          githubErrorHint: '请检查 gh 的登录状态与网络后重试。',
          githubChecking: '正在检查 GitHub 连接…',
          githubIdle: '尚未检查 GitHub 连接，点击刷新开始。',
          cloudflareNotInstalled: '未检测到 wrangler。请先安装 Wrangler 并登录，然后刷新连接。',
          cloudflareNotInstalledHint: 'npm install -g wrangler',
          cloudflareNotAuthenticated: 'wrangler 已安装但尚未登录。',
          cloudflareNotAuthenticatedHint: 'wrangler login',
          cloudflareErrorHint: '请检查 wrangler 登录状态与网络后重试。',
          cloudflareChecking: '正在检查 Cloudflare 连接…',
          cloudflareIdle: '尚未检查 Cloudflare 连接，点击刷新开始。',
        },
        settings: {
          cacheTitle: '缓存',
          clearAll: '清空全部缓存',
          clearAllConfirm: '确认清空全部缓存？',
          clearAllHint: '删除所有缓存的历史与临时数据，保留监控项与设置。',
          clearHistory: '清空历史',
          clearHistoryConfirm: '确认清空历史？',
          clearHistoryHint: '删除网站与服务器的时间序列历史，保留监控项与设置。',
          cnProbes: 'CN 探测数量',
          cnProbesHint: '每次检测从 Globalping 选择的中国大陆节点数量。',
          cooldown: '冷却中（{time}）',
          countryRequired: '请至少选择一个海外国家。',
          dataDirEmpty: 'Host 尚未提供数据目录。',
          dataDirHint: '监控数据与配置保存在本机；可复制路径查看。',
          dataDirTitle: '数据目录',
          globalCountries: '海外探测国家',
          globalCountriesHint: '至少选择一个国家；Globalping 会从中选择节点。',
          interval: '检测间隔',
          intervalUnit: '{n} 分钟',
          monitor: '监控设置',
          monitorEnabled: '启用后台检测',
          monitorHint: '关闭后不再自动运行检测；手动检测仍然可用。',
          privacyTitle: '隐私与安全',
          probeUnit: '{n} 个',
          quotaFetched: '最近获取 {time}',
          quotaHint: '配额由 Globalping 提供，本机探测不计入。',
          quotaBinding: '匿名 API 配额，按本机公网出口 IP 计量，不绑定 DSH/GitHub 账号；同一出口 IP 的其他使用会共用这个额度。',
          quotaAnonymous: '匿名 · 未绑定账号',
          quotaTitle: 'Globalping 配额',
          quotaUnavailable: '还没有配额信息。',
          refreshConnections: '刷新连接',
          remainingValue: '{remaining} / {limit}',
          resetIn: '约 {n} 分钟后重置',
          resetUnknown: '重置时间未知',
          save: '保存设置',
          saveBusy: '保存中…',
          savedHint: '设置保存后 Host 会立即应用。',
          settingsUnavailable: '设置尚未就绪，请稍等或刷新。',
          toolGh: 'GitHub CLI',
          toolInstalled: '已安装',
          toolMissing: '未安装',
          toolMissingHint: '缺少工具时，相应功能不可用。',
          toolPath: '路径',
          toolSsh: 'SSH',
          toolUnknown: '待检测',
          toolVersion: '版本',
          toolWrangler: 'Wrangler',
          toolsHint: '工具状态来自 Host 本机检测；安装或登录后点击刷新连接。',
          toolsTitle: '本机工具',
          privacy1: '不保存任何 Token、密码或私钥内容；SSH 只使用本机已有的密钥或 ssh-agent。',
          privacy2: '探测命令在本机执行；需要访问外网的部分只发送目标域名。',
          privacy3: 'Globalping 会接收到被检测网站的域名与路径，请勿添加含敏感参数的网址。',
          privacy4: 'itdog 链接仅由你手动点击打开，插件不会自动提交。',
          privacy5: 'GitHub 与 Cloudflare 的认证复用本机 gh / wrangler 登录状态。',
        },
        notes: {
          cacheCleared: '全部缓存已清空。',
          checkAllStarted: '已开始检测全部项。',
          cloudflareRefreshed: 'Cloudflare 已刷新。',
          connectionsRefreshed: '连接已刷新。',
          githubRefreshed: 'GitHub 已刷新。',
          historyCleared: '历史已清空。',
          projectAdded: '项目已添加。',
          projectRemoved: '项目已移除。',
          refreshedAll: '已刷新全部数据。',
          repoAdded: '仓库已添加。',
          repoRemoved: '仓库已移除。',
          serverAdded: '服务器已添加。',
          serverChecked: '服务器检测已开始。',
          serverRemoved: '服务器已删除。',
          settingsSaved: '设置已保存。',
          siteAdded: '网站已添加。',
          siteChecked: '网站检测已开始。',
          siteRemoved: '网站已删除。',
          siteToggled: '网站状态已更新。',
        },
      },
      en: {
        panelTitle: 'Ops console',
        boundary: {
          title: 'The ops console failed to render',
          text: 'A front-end error interrupted the page. Try again; if it repeats, reload the page or check the browser console.',
          retry: 'Try again',
        },
        panelSubtitle: 'Local operations console for websites, SSH servers, GitHub and Cloudflare.',
        brand: {
          globalping: 'Globalping',
          itdog: 'itdog',
        },
        tabs: {
          label: 'Ops console sections',
          overview: 'Overview',
          sites: 'Websites',
          servers: 'Servers',
          platforms: 'Platforms',
          settings: 'Settings',
        },
        common: {
          checkNow: 'Check now',
          checking: 'Checking…',
          close: 'Close',
          collapse: 'Collapse',
          confirmDelete: 'Confirm delete',
          copied: 'Copied',
          copy: 'Copy',
          copyFailed: 'Copy failed',
          delete: 'Delete',
          details: 'Details',
          disabled: 'Disabled',
          enabled: 'Enabled',
          loading: 'Loading…',
          name: 'Name',
          neverRefreshed: 'Never refreshed',
          no: 'No',
          none: '—',
          refreshing: 'Refreshing…',
          remove: 'Remove',
          retry: 'Retry',
          status: 'Status',
          time: 'Time',
          tooLong: 'Content truncated',
          unknown: 'Unknown',
          working: 'Working…',
          yes: 'Yes',
        },
        units: {
          days: 'd',
          hours: 'h',
          minutes: 'min',
          ms: 'ms',
        },
        time: {
          justNow: 'just now',
          soon: 'soon',
          inMinutes: 'in {n} min',
          minutesAgo: '{n} min ago',
          inHours: 'in {n} h',
          hoursAgo: '{n} h ago',
          inDays: 'in {n} d',
          daysAgo: '{n} d ago',
        },
        status: {
          up: 'Up',
          degraded: 'Degraded',
          down: 'Down',
          unknown: 'Unknown',
          online: 'Online',
          warning: 'Warning',
          offline: 'Offline',
          connected: 'Connected',
          'not-installed': 'Not installed',
          'not-authenticated': 'Not signed in',
          error: 'Error',
          checking: 'Checking',
          idle: 'Idle',
          loading: 'Loading',
          ok: 'OK',
          completed: 'Completed',
          success: 'Success',
          failure: 'Failure',
          timed_out: 'Timed out',
          action_required: 'Action required',
          startup_failure: 'Startup failure',
          in_progress: 'In progress',
          queued: 'Queued',
          waiting: 'Waiting',
          pending: 'Pending',
          skipped: 'Skipped',
          neutral: 'Neutral',
          cancelled: 'Cancelled',
          valid: 'Valid',
          invalid: 'Invalid',
        },
        header: {
          lastRefreshLabel: 'Last refresh',
          monitorInterval: 'Every {n} min',
          monitorOn: 'Monitoring on',
          monitorPaused: 'Monitoring paused',
          monitorRunning: 'Checking now',
          nextRun: 'Next check {time}',
          refreshAll: 'Refresh all',
        },
        banner: {
          actionTitle: 'Action failed',
          authHint: 'Make sure this DSH session may access the ops console API, then retry.',
          authMessage: 'The ops console API rejected this request.',
          authTitle: 'Access denied',
          autoRetry: 'It retries automatically.',
          loadingFailedText: 'Could not load ops console data. Make sure the Host half is enabled, then retry.',
          loadingFailedTitle: 'Unable to load',
          networkHint: 'It retries automatically in a moment; you can also retry now.',
          networkMessage: 'The request to /api/ops-console failed. The Host half may be disabled or the connection lost.',
          networkTitle: 'Cannot reach the local ops service',
          serverMessage: 'The service returned an unknown error.',
          timeoutHint: 'The Host may be running a long command.',
          timeoutMessage: 'The ops service did not respond within 15 seconds.',
          timeoutTitle: 'Request timed out',
        },
        overview: {
          attention: 'Needs attention',
          attentionEmpty: 'No websites need attention right now.',
          attentionNoSites: 'No websites yet; failing ones will appear here after you add some.',
          cloudflareStateHint: 'Cloudflare connection not checked yet',
          dataSources: 'Data sources and how it runs',
          githubStateHint: 'GitHub connection not checked yet',
          noSitesTitle: 'No websites yet',
          sourceGlobalpingText: 'provides multi-country probe nodes;',
          sourceItdogText: 'is only a manual third-party speed-test link; nothing is submitted automatically;',
          sourceLocal: 'Local direct probe',
          sourceLocalText: 'adds DNS, TCP, TLS, TTFB and redirect details;',
          sourceRun: 'How monitoring runs',
          sourceRunText: 'monitoring runs locally while DSH is open and pauses when DSH closes.',
          statCloudflare: 'Cloudflare',
          statCloudflareHint: 'account {name}',
          statCnMedian: 'CN median latency',
          statGithub: 'GitHub',
          statGithubHint: 'account {login}',
          statGlobalMedian: 'Global median latency',
          statMedianHint: 'median across enabled sites',
          statServers: 'Servers online',
          statServersHint: '{n} total',
          statSites: 'Websites',
          statSitesHint: '{up} up · {down} need attention',
        },
        sites: {
          addBusy: 'Adding…',
          addSubmit: 'Add website',
          addTitle: 'Add a website',
          bodyBytes: 'Response size',
          checkAll: 'Check all',
          checkingAll: 'Checking all…',
          cnMedian: 'CN median latency',
          cnNodes: 'Mainland China nodes',
          copyHost: 'Copy hostname',
          countLabel: '{n} websites, {up} up, {issue} with issues',
          daysValue: '{n} d',
          deleteConfirm: 'Delete? This only removes the monitor entry.',
          disabledNote: 'Disabled: automatic checks are paused.',
          dns: 'DNS',
          emptyText: 'Fill in a name and URL above to add one. The Host starts the first check automatically; if it does not, use "Check now".',
          emptyTitle: 'No websites yet',
          failures: 'Failed nodes',
          finalUrl: 'Final URL',
          formUrlInvalid: 'Enter a valid URL starting with http:// or https://.',
          formUrlRequired: 'Enter a website URL.',
          globalMedian: 'Global median latency',
          globalNodes: 'Global nodes',
          globalError: 'Probe error',
          groupError: 'Probe error: {message}',
          groupSkipped: 'This probe group was skipped',
          groupSummary: '{total} nodes · {success} ok · {failed} failed',
          historyLegendCn: 'CN',
          historyLegendGlobal: 'Global',
          historyLegendLocal: 'Local',
          historyPoints: 'last {n} samples',
          historyTitle: 'Latency history',
          itdog: 'Open in itdog',
          lastChecked: 'Last checked',
          localMedian: 'Local median latency',
          localStatus: 'Status code',
          localTitle: 'Local probe',
          nameLabel: 'Name (optional)',
          namePlaceholder: 'e.g. Main site',
          noHistory: 'Not enough history to draw a chart yet.',
          noProbe: 'Not checked yet. Use "Check now" to start.',
          nodesEmpty: 'No node data.',
          reachable: 'Reachable',
          reasons: 'Reasons',
          redirectTitle: 'Redirect chain',
          redirectsEmpty: 'No redirects.',
          tableCountry: 'Country',
          tableLatency: 'Latency',
          tableNetwork: 'Network',
          tableNode: 'Node',
          tableResult: 'Result',
          tableStatus: 'Status',
          tableStep: 'Step',
          tableUrl: 'URL',
          tcp: 'TCP',
          timings: 'Timing breakdown',
          tls: 'TLS',
          tlsDays: 'TLS days left',
          tlsIssuer: 'Issuer',
          tlsProtocol: 'Protocol',
          tlsTitle: 'TLS certificate',
          tlsValid: 'Certificate status',
          statusHint: '"Degraded" means the site is still reachable but some probes failed, TLS is invalid/expiring, or the local probe got 401/403. "Down" means the local probe is unreachable or got an unexpected status.',
          statusLegend: 'Status guide',
          statusUpDesc: 'Local 2xx/3xx, no failed CN/overseas probes, valid TLS.',
          statusDegradedDesc: 'Still reachable, but some probes failed, TLS is invalid/expiring, or the local probe got 401/403 (WAF/auth).',
          statusDownDesc: 'Unreachable locally, or an unexpected 4xx/5xx status.',
          statusUnknownDesc: 'No completed check yet, or the last check was cancelled.',
          toggleEnabled: 'Enabled state',
          total: 'Total',
          ttfb: 'First byte (incl. connect)',
          unnamed: 'Unnamed website',
          uptime: 'Uptime',
          urlLabel: 'URL',
          urlPlaceholder: 'https://example.com',
        },
        servers: {
          addBusy: 'Adding…',
          addSubmit: 'Add server',
          addTitle: 'Add a server',
          checkAll: 'Check all',
          checkingAll: 'Checking all…',
          coresHint: '{n} cores',
          countLabel: '{n} servers, {online} online',
          deleteConfirm: 'Delete?',
          disk: 'Disk',
          docker: 'Docker containers',
          dockerValue: '{n}',
          duration: 'Duration',
          emptyText: 'Add an SSH server to see status, load, memory, disk and services. Key-based auth only.',
          emptyTitle: 'No servers yet',
          errorTitle: 'Error',
          failedUnits: 'Failed units',
          failedUnitsHint: 'Some systemd units failed',
          failedUnitsValue: '{n}',
          formHint: 'With an empty identity path, ssh resolves ~/.ssh/config, default keys and ssh-agent itself. With an empty user, ssh uses the local account name (not necessarily root). On macOS, use Choose file… to pick a key.',
          pickKey: 'Choose file…',
          pickKeyBusy: 'Choosing…',
          pickKeyHint: 'macOS opens the system file chooser; other platforms need a typed path.',
          copyCommand: 'Copy',
          keyHelpTitle: 'How local SSH keys are used',
          keyHelpIntro: 'With an empty identity path, ssh itself uses ~/.ssh/config, default keys (~/.ssh/id_*) and ssh-agent. The plugin does not read those files and never stores passwords.',
          keyHelpList: 'Inspect the ~/.ssh directory:',
          keyHelpAgent: 'List keys loaded in ssh-agent:',
          keyHelpConfig: 'Show the effective hostname/user/port/identityFile for a target:',
          keyHelpManage: 'Add a key to the agent (macOS may use --apple-use-keychain):',
          keyHelpPermissions: 'Recommended private-key permissions (600):',
          keyHelpNote: 'If ssh-add -l says the agent is not running, run eval "$(ssh-agent -s)" in a terminal first.',
          verifyCommandHint: 'Run this command in a terminal, confirm the host key/login, then retry:',
          verifyCommand: 'Terminal verification command',
          hostname: 'Hostname',
          identityLabel: 'Identity file (optional)',
          identityNote: 'Identity file: {path}',
          identityPlaceholder: 'Leave empty to use the default key or agent',
          labelLabel: 'Label (optional)',
          labelPlaceholder: 'e.g. Tokyo node',
          lastChecked: 'Last checked',
          load: 'Load',
          loadValue: '{l1} / {l5} / {l15}',
          memory: 'Memory',
          neverChecked: 'Not checked yet',
          os: 'OS',
          portInvalid: 'Port must be an integer from 1 to 65535.',
          portLabel: 'Port (optional)',
          rawEmpty: 'The Host has not returned raw output yet.',
          rawTitle: 'Raw output',
          sshHint: 'Make sure passwordless SSH to the target works with a key or ssh-agent, then check.',
          targetLabel: 'Target',
          targetNote: '{user}@{target}:{port}',
          targetPlaceholder: 'Hostname or SSH alias',
          targetRequired: 'Enter a target host or SSH alias.',
          uptime: 'Uptime',
          userLabel: 'User',
          userPlaceholder: 'root',
          warnings: 'Warnings',
        },
        platforms: {
          account: 'Account',
          accountCount: '{n} accounts',
          accountId: 'Account ID',
          accounts: 'Available accounts',
          branch: 'Branch',
          buildLink: 'Build',
          cloudflareAddHint: 'Enter a Cloudflare Pages project name; if unsure, refresh first to list existing projects.',
          cloudflareAddInvalid: 'Enter a valid project name.',
          cloudflareAddLabel: 'Add a Pages project',
          cloudflareAddPlaceholder: 'Project name',
          cloudflareAddSubmit: 'Add project',
          cloudflareTitle: 'Cloudflare',
          connection: 'Connection',
          dashboard: 'Open dashboard',
          discovered: 'Discovered, not monitored',
          discoveredHint: 'Click to add monitoring',
          deploymentUrl: 'URL',
          deployments: 'Recent deployments',
          deploymentsEmpty: 'No deployments.',
          email: 'Email',
          environment: 'Environment',
          gitProvider: 'Git-backed',
          githubAddHint: 'Enter the full GitHub repository name, e.g. vercel/next.js.',
          githubAddInvalid: 'Enter a repository in owner/name form.',
          githubAddLabel: 'Add a repository',
          githubAddPlaceholder: 'owner/name',
          githubAddSubmit: 'Add repository',
          githubRepos: 'Watched repositories',
          githubTitle: 'GitHub',
          lastFetched: 'Last fetched',
          lastModified: 'Last modified',
          latestRuns: 'Latest workflow runs',
          openPRs: 'Open pull requests',
          openPRsCount: '{n}',
          openPRsEmpty: 'No open pull requests.',
          permissions: 'Permissions',
          permissionsCount: '{n} permissions',
          projectEmpty: 'No Cloudflare Pages projects watched yet.',
          refresh: 'Refresh',
          refreshing: 'Refreshing…',
          removeProjectConfirm: 'Remove?',
          removeRepoConfirm: 'Remove?',
          repoEmpty: 'No repositories watched yet. Add owner/name to see recent runs and PRs.',
          runsEmpty: 'No workflow runs.',
          source: 'Commit',
          version: 'Version',
          watchlistEmptyHint: 'Empty lists show no fake data; add an item to see real status.',
          githubNotInstalled: 'GitHub CLI (gh) was not found. Install it, sign in, then refresh the connection.',
          githubNotInstalledHint: 'brew install gh',
          githubNotAuthenticated: 'GitHub CLI is installed but not signed in.',
          githubNotAuthenticatedHint: 'gh auth login',
          githubErrorHint: 'Check gh auth and network connectivity, then retry.',
          githubChecking: 'Checking the GitHub connection…',
          githubIdle: 'GitHub connection not checked yet. Refresh to start.',
          cloudflareNotInstalled: 'Wrangler was not found. Install it, sign in, then refresh the connection.',
          cloudflareNotInstalledHint: 'npm install -g wrangler',
          cloudflareNotAuthenticated: 'Wrangler is installed but not signed in.',
          cloudflareNotAuthenticatedHint: 'wrangler login',
          cloudflareErrorHint: 'Check wrangler auth and network connectivity, then retry.',
          cloudflareChecking: 'Checking the Cloudflare connection…',
          cloudflareIdle: 'Cloudflare connection not checked yet. Refresh to start.',
        },
        settings: {
          cacheTitle: 'Cache',
          clearAll: 'Clear all caches',
          clearAllConfirm: 'Clear all caches?',
          clearAllHint: 'Deletes cached history and temporary data; watchlists and settings are kept.',
          clearHistory: 'Clear history',
          clearHistoryConfirm: 'Clear history?',
          clearHistoryHint: 'Deletes time-series history for websites and servers; watchlist items and settings are kept.',
          cnProbes: 'CN probes',
          cnProbesHint: 'Number of mainland-China Globalping nodes used per check.',
          cooldown: 'Cooling down ({time})',
          countryRequired: 'Select at least one global country.',
          dataDirEmpty: 'The Host has not provided a data directory yet.',
          dataDirHint: 'Monitoring data and configuration stay on this machine; copy the path to inspect it.',
          dataDirTitle: 'Data directory',
          globalCountries: 'Global probe countries',
          globalCountriesHint: 'Select at least one country; Globalping picks nodes from them.',
          interval: 'Check interval',
          intervalUnit: '{n} min',
          monitor: 'Monitoring',
          monitorEnabled: 'Enable background checks',
          monitorHint: 'When off, automatic checks stop; manual checks still work.',
          privacyTitle: 'Privacy and security',
          probeUnit: '{n}',
          quotaFetched: 'Last fetched {time}',
          quotaHint: 'The quota comes from Globalping; local probes do not count.',
          quotaBinding: 'Anonymous API quota, counted per public egress IP. It is not tied to a DSH/GitHub account, and other clients behind the same IP share it.',
          quotaAnonymous: 'Anonymous · no account',
          quotaTitle: 'Globalping quota',
          quotaUnavailable: 'No quota information yet.',
          refreshConnections: 'Refresh connections',
          remainingValue: '{remaining} / {limit}',
          resetIn: 'Resets in about {n} min',
          resetUnknown: 'Reset time unknown',
          save: 'Save settings',
          saveBusy: 'Saving…',
          savedHint: 'The Host applies settings immediately after saving.',
          settingsUnavailable: 'Settings are not ready yet; wait or refresh.',
          toolGh: 'GitHub CLI',
          toolInstalled: 'Installed',
          toolMissing: 'Missing',
          toolMissingHint: 'Features that need a missing tool stay unavailable.',
          toolPath: 'Path',
          toolSsh: 'SSH',
          toolUnknown: 'Not checked',
          toolVersion: 'Version',
          toolWrangler: 'Wrangler',
          toolsHint: 'Tool status comes from the Host machine; after installing or signing in, refresh connections.',
          toolsTitle: 'Local tools',
          privacy1: 'No token, password or private key content is stored; SSH uses keys or ssh-agent already on this machine.',
          privacy2: 'Probe commands run locally; outbound probes only send the target hostname and path.',
          privacy3: 'Globalping receives the hostname and path being checked; avoid URLs with sensitive query parameters.',
          privacy4: 'itdog links only open when you click them; the plugin never submits automatically.',
          privacy5: 'GitHub and Cloudflare auth reuse the local gh / wrangler sign-in.',
        },
        notes: {
          cacheCleared: 'All caches cleared.',
          checkAllStarted: 'Checking all items.',
          cloudflareRefreshed: 'Cloudflare refreshed.',
          connectionsRefreshed: 'Connections refreshed.',
          githubRefreshed: 'GitHub refreshed.',
          historyCleared: 'History cleared.',
          projectAdded: 'Project added.',
          projectRemoved: 'Project removed.',
          refreshedAll: 'Refreshed all data.',
          repoAdded: 'Repository added.',
          repoRemoved: 'Repository removed.',
          serverAdded: 'Server added.',
          serverChecked: 'Server check started.',
          serverRemoved: 'Server removed.',
          settingsSaved: 'Settings saved.',
          siteAdded: 'Website added.',
          siteChecked: 'Website check started.',
          siteRemoved: 'Website removed.',
          siteToggled: 'Website state updated.',
        },
      },
    };

    // =========================================================================
    // Locale service bridge
    // =========================================================================

    let localeService = null;

    /** Read the active locale id, preferring the locale service. */
    function readActiveLocaleId() {
      if (localeService) {
        try {
          if (typeof localeService.getLocale === 'function') {
            const snapshot = localeService.getLocale();
            if (snapshot && typeof snapshot.active === 'string') return snapshot.active;
          }
          if (typeof localeService.getSnapshot === 'function') {
            const snapshot = localeService.getSnapshot();
            if (snapshot && typeof snapshot.active === 'string') return snapshot.active;
          }
        } catch (err) {
          // Fall through to the browser language.
        }
      }
      if (typeof navigator !== 'undefined' && typeof navigator.language === 'string') {
        return navigator.language;
      }
      return 'en';
    }

    /** Only two dictionaries ship: any id starting with "zh" is Chinese. */
    function activeLocale() {
      const id = readActiveLocaleId();
      return typeof id === 'string' && id.toLowerCase().indexOf('zh') === 0 ? 'zh' : 'en';
    }

    function readDictionaryValue(dictionary, key) {
      if (!dictionary || typeof dictionary !== 'object') return undefined;
      const parts = String(key).split('.');
      let node = dictionary;
      for (let i = 0; i < parts.length; i += 1) {
        if (!node || typeof node !== 'object' || !Object.prototype.hasOwnProperty.call(node, parts[i])) {
          return undefined;
        }
        node = node[parts[i]];
      }
      return node;
    }

    function lookupMessage(localeId, key) {
      let value = readDictionaryValue(MESSAGES[localeId], key);
      if (typeof value !== 'string') value = readDictionaryValue(MESSAGES.en, key);
      return typeof value === 'string' ? value : String(key);
    }

    function formatTemplate(template, params) {
      if (!params) return template;
      return String(template).replace(/\{(\w+)\}/g, (match, name) => {
        if (!Object.prototype.hasOwnProperty.call(params, name)) return match;
        const value = params[name];
        return value === undefined || value === null ? match : String(value);
      });
    }

    function translate(localeId, key, params) {
      return formatTemplate(lookupMessage(localeId, key), params);
    }

    /** Sidebar label: resolved lazily so a locale switch is picked up. */
    function labelForCurrentLocale() {
      return lookupMessage(activeLocale(), 'panelTitle');
    }

    const I18nContext = React.createContext({ locale: 'zh', t: (key) => key });

    function useI18n() {
      return React.useContext(I18nContext);
    }

    /** Subscribe to locale changes and expose a translate function. */
    function useI18nValue() {
      const [localeId, setLocaleId] = useState(activeLocale);
      useEffect(() => {
        if (!localeService || typeof localeService.subscribe !== 'function') return undefined;
        let disposed = false;
        const update = () => {
          if (!disposed) setLocaleId(activeLocale());
        };
        let unsubscribe = null;
        try {
          unsubscribe = localeService.subscribe(update);
        } catch (err) {
          unsubscribe = null;
        }
        update();
        return () => {
          disposed = true;
          if (typeof unsubscribe === 'function') {
            try {
              unsubscribe();
            } catch (err) {
              /* ignore */
            }
          }
        };
      }, []);
      return useMemo(() => {
        return {
          locale: localeId,
          t(key, params) {
            return translate(localeId, key, params);
          },
        };
      }, [localeId]);
    }

    // =========================================================================
    // Small generic utilities
    // =========================================================================

    function asArray(value) {
      return Array.isArray(value) ? value : [];
    }

    function asObject(value) {
      return value && typeof value === 'object' ? value : {};
    }

    function isFiniteNumber(value) {
      return typeof value === 'number' && Number.isFinite(value);
    }

    function mergeClasses() {
      const list = [];
      for (let i = 0; i < arguments.length; i += 1) {
        const value = arguments[i];
        if (value) list.push(value);
      }
      return list.join(' ');
    }

    function safeExternalUrl(value) {
      if (typeof value !== 'string') return null;
      try {
        const parsed = new URL(value);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
        return parsed.href;
      } catch (err) {
        return null;
      }
    }

    function isHttpUrl(value) {
      return safeExternalUrl(value) !== null;
    }

    function hostFromUrl(value) {
      if (typeof value !== 'string') return '';
      try {
        return new URL(value).hostname;
      } catch (err) {
        return '';
      }
    }

    function clampPercent(value) {
      if (!isFiniteNumber(value)) return null;
      return Math.max(0, Math.min(100, value));
    }

    function median(values) {
      const list = [];
      for (let i = 0; i < values.length; i += 1) {
        if (isFiniteNumber(values[i])) list.push(values[i]);
      }
      if (list.length === 0) return null;
      list.sort((a, b) => a - b);
      const middle = Math.floor(list.length / 2);
      if (list.length % 2 === 1) return list[middle];
      return (list[middle - 1] + list[middle]) / 2;
    }

    // =========================================================================
    // Formatting helpers (locale-aware through the injected t function)
    // =========================================================================

    function formatMs(t, value) {
      if (!isFiniteNumber(value)) return t('common.none');
      return Math.round(value) + ' ' + t('units.ms');
    }

    function formatPercent(value, digits) {
      if (!isFiniteNumber(value)) return '—';
      const places = typeof digits === 'number' ? digits : 0;
      return value.toFixed(places) + '%';
    }

    function formatUptime(t, seconds) {
      if (!isFiniteNumber(seconds) || seconds < 0) return t('common.none');
      const total = Math.floor(seconds);
      const days = Math.floor(total / 86400);
      const hours = Math.floor((total % 86400) / 3600);
      const minutes = Math.floor((total % 3600) / 60);
      if (days > 0) return days + ' ' + t('units.days') + ' ' + hours + ' ' + t('units.hours');
      if (hours > 0) return hours + ' ' + t('units.hours') + ' ' + minutes + ' ' + t('units.minutes');
      return minutes + ' ' + t('units.minutes');
    }

    function formatBytes(value) {
      if (!isFiniteNumber(value) || value < 0) return '—';
      const units = ['B', 'KB', 'MB', 'GB', 'TB'];
      let amount = value;
      let index = 0;
      while (amount >= 1024 && index < units.length - 1) {
        amount /= 1024;
        index += 1;
      }
      return (index === 0 ? String(Math.round(amount)) : amount.toFixed(amount >= 10 ? 0 : 1)) + ' ' + units[index];
    }

    function toTimestamp(value) {
      if (isFiniteNumber(value) && value > 0) return value;
      if (typeof value === 'string' && value !== '') {
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
      }
      return null;
    }

    function formatRelative(t, timestamp, now) {
      const at = toTimestamp(timestamp);
      if (at === null) return t('common.none');
      const delta = Number(now) - at;
      const absolute = Math.abs(delta);
      const future = delta < 0;
      if (absolute < 45000) return t(future ? 'time.soon' : 'time.justNow');
      const minutes = Math.round(absolute / 60000);
      if (minutes < 60) return t(future ? 'time.inMinutes' : 'time.minutesAgo', { n: Math.max(1, minutes) });
      const hours = Math.round(absolute / 3600000);
      if (hours < 24) return t(future ? 'time.inHours' : 'time.hoursAgo', { n: Math.max(1, hours) });
      const days = Math.round(absolute / 86400000);
      return t(future ? 'time.inDays' : 'time.daysAgo', { n: Math.max(1, days) });
    }

    function formatAbsolute(localeId, timestamp) {
      const at = toTimestamp(timestamp);
      if (at === null) return '';
      try {
        return new Date(at).toLocaleString(localeId === 'zh' ? 'zh-CN' : 'en-US', {
          year: 'numeric',
          month: '2-digit',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        });
      } catch (err) {
        return new Date(at).toISOString();
      }
    }

    function numericText(value) {
      return isFiniteNumber(value) ? String(value) : '—';
    }

    // =========================================================================
    // Status vocabulary
    // =========================================================================

    const SITE_TONES = { up: 'success', degraded: 'warn', down: 'error', unknown: 'idle' };
    const SERVER_TONES = { online: 'success', warning: 'warn', offline: 'error' };
    const PLATFORM_TONES = {
      connected: 'success',
      checking: 'brand',
      idle: 'idle',
      'not-installed': 'warn',
      'not-authenticated': 'warn',
      error: 'error',
    };
    const RUN_TONES = {
      success: 'success',
      completed: 'success',
      failure: 'error',
      timed_out: 'error',
      action_required: 'error',
      startup_failure: 'error',
      in_progress: 'brand',
      queued: 'warn',
      waiting: 'warn',
      pending: 'warn',
      skipped: 'idle',
      neutral: 'idle',
      cancelled: 'idle',
    };

    function siteTone(status) {
      return SITE_TONES[status] || 'idle';
    }

    function serverTone(status) {
      return SERVER_TONES[status] || 'idle';
    }

    function platformTone(state) {
      return PLATFORM_TONES[state] || 'idle';
    }

    function runTone(value) {
      return RUN_TONES[value] || 'idle';
    }

    function statusLabel(t, value) {
      if (!value) return t('status.unknown');
      const key = 'status.' + String(value);
      const text = t(key);
      return text === key ? String(value) : text;
    }

    function platformStateLabel(t, value) {
      if (!value) return t('status.unknown');
      const key = 'status.' + String(value);
      const text = t(key);
      return text === key ? String(value) : text;
    }

    function isPendingSnapshot(snapshot) {
      const plugin = snapshot && typeof snapshot === 'object' ? snapshot.plugin : null;
      if (!plugin || typeof plugin !== 'object') return false;
      if (plugin.running) return true;
      const pending = plugin.pending;
      if (!pending || typeof pending !== 'object') return false;
      if (asArray(pending.sites).length > 0) return true;
      if (asArray(pending.servers).length > 0) return true;
      if (pending.github || pending.cloudflare || pending.connections) return true;
      return false;
    }

    // =========================================================================
    // Data layer: snapshot fetch, polling, action dispatch
    // =========================================================================

    function isAbortError(err) {
      return Boolean(err) && (err.name === 'AbortError' || err.code === 'ABORT_ERR');
    }

    function errorFromPayload(payload, fallbackCode) {
      const detail = payload && typeof payload === 'object' && payload.error ? payload.error : {};
      const error = new Error(typeof detail.message === 'string' ? detail.message : '');
      error.code = typeof detail.code === 'string' && detail.code ? detail.code : fallbackCode || 'request_failed';
      error.hint = typeof detail.hint === 'string' ? detail.hint : '';
      return error;
    }

    function classifyError(err) {
      const status = err && isFiniteNumber(err.status) ? err.status : null;
      const code = err && typeof err.code === 'string' && err.code ? err.code : status !== null ? 'http_' + status : 'request_failed';
      let kind;
      if (status === 401 || status === 403) kind = 'auth';
      else if (code === 'timeout') kind = 'timeout';
      else if (status !== null || code === 'rejected' || code === 'bad_response' || code === 'snapshot_failed') kind = 'server';
      else kind = 'network';
      return {
        kind,
        code,
        status,
        message: err && typeof err.message === 'string' ? err.message : '',
        hint: err && typeof err.hint === 'string' ? err.hint : '',
      };
    }

    /**
     * Owns the snapshot, its polling loop and every action request.
     * All fetches abort after 15s and no state is written after unmount.
     */
    function useOpsData() {
      const [snapshot, setSnapshot] = useState(null);
      const [loading, setLoading] = useState(true);
      const [error, setError] = useState(null);
      const [note, setNote] = useState(null);
      const [busyMap, setBusyMap] = useState({});
      const [lastRefreshAt, setLastRefreshAt] = useState(null);

      const mountedRef = useRef(false);
      const controllersRef = useRef(new Set());
      const snapshotSeqRef = useRef(0);
      const snapshotPromiseRef = useRef(null);
      const attemptRef = useRef(0);
      const nextAttemptAtRef = useRef(0);
      const busyMapRef = useRef({});
      const busyCountRef = useRef(0);
      const noteSeqRef = useRef(0);

      useEffect(() => {
        busyMapRef.current = busyMap;
        busyCountRef.current = Object.keys(busyMap).length;
      }, [busyMap]);

      /** fetch + JSON + timeout + uniform error shape */
      const requestJson = useCallback(async (path, init, timeoutMs) => {
        const controller = new AbortController();
        const entry = { controller, timedOut: false };
        controllersRef.current.add(entry);
        const timer = setTimeout(() => {
          entry.timedOut = true;
          try {
            controller.abort();
          } catch (err) {
            /* ignore */
          }
        }, Number.isFinite(timeoutMs) ? timeoutMs : FETCH_TIMEOUT_MS);
        try {
          const response = await fetch(path, {
            credentials: 'same-origin',
            cache: 'no-store',
            ...(init || {}),
            signal: controller.signal,
          });
          let data = null;
          const text = await response.text();
          if (text) {
            try {
              data = JSON.parse(text);
            } catch (err) {
              data = null;
            }
          }
          if (!response.ok) {
            const failure = errorFromPayload(data, 'http_' + response.status);
            failure.status = response.status;
            throw failure;
          }
          if (data && typeof data === 'object' && data.ok === false) {
            throw errorFromPayload(data, 'rejected');
          }
          return data;
        } catch (err) {
          if (entry.timedOut) {
            const timeoutError = new Error('timeout');
            timeoutError.code = 'timeout';
            throw timeoutError;
          }
          throw err;
        } finally {
          clearTimeout(timer);
          controllersRef.current.delete(entry);
        }
      }, []);

      const fetchSnapshot = useCallback((options) => {
        const force = Boolean(options && options.force);
        if (!force && snapshotPromiseRef.current) return snapshotPromiseRef.current;
        const seq = ++snapshotSeqRef.current;
        const promise = (async () => {
          try {
            const data = await requestJson(API_SNAPSHOT, { method: 'GET' });
            if (!mountedRef.current || seq !== snapshotSeqRef.current) return null;
            if (!data || typeof data !== 'object') {
              const bad = new Error('');
              bad.code = 'bad_response';
              throw bad;
            }
            if (data.ok === false) throw errorFromPayload(data, 'snapshot_failed');
            attemptRef.current = 0;
            nextAttemptAtRef.current = 0;
            setSnapshot(data);
            setLoading(false);
            setLastRefreshAt(Date.now());
            setError((previous) => (previous && previous.source === 'snapshot' ? null : previous));
            return data;
          } catch (err) {
            if (!mountedRef.current || seq !== snapshotSeqRef.current || isAbortError(err)) return null;
            attemptRef.current += 1;
            const backoffMs = Math.min(BACKOFF_MAX_MS, 1000 * Math.pow(2, Math.min(attemptRef.current - 1, 5)));
            nextAttemptAtRef.current = Date.now() + backoffMs;
            setLoading(false);
            setError({
              source: 'snapshot',
              ...classifyError(err),
              retryInMs: backoffMs,
              at: Date.now(),
            });
            return null;
          }
        })();
        snapshotPromiseRef.current = promise;
        const clearPromise = () => {
          if (snapshotPromiseRef.current === promise) snapshotPromiseRef.current = null;
        };
        promise.then(clearPromise, clearPromise);
        return promise;
      }, [requestJson]);

      // Initial mount fetch + cleanup of every in-flight request.
      useEffect(() => {
        mountedRef.current = true;
        void fetchSnapshot();
        return () => {
          mountedRef.current = false;
          snapshotSeqRef.current += 1;
          snapshotPromiseRef.current = null;
          controllersRef.current.forEach((entry) => {
            try {
              entry.controller.abort();
            } catch (err) {
              /* ignore */
            }
          });
          controllersRef.current.clear();
        };
      }, [fetchSnapshot]);

      const postAction = useCallback((payload, timeoutMs) => {
        return requestJson(API_ACTION, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }, timeoutMs);
      }, [requestJson]);

      const setBusyKey = useCallback((key, value) => {
        const next = { ...busyMapRef.current };
        if (value) next[key] = true;
        else delete next[key];
        busyMapRef.current = next;
        busyCountRef.current = Object.keys(next).length;
        if (mountedRef.current) setBusyMap(next);
      }, []);

      /**
       * Run one action. Resolves to the Host response, or null on failure.
       * options: { note, refresh:false, after(result, snapshot), preserveError }
       */
      const runAction = useCallback(async (key, payload, options) => {
        const opts = options || {};
        if (busyMapRef.current[key]) return null;
        setBusyKey(key, true);
        if (!opts.preserveError) {
          setError((previous) => (previous && previous.source === 'action' ? null : previous));
        }
        try {
          const result = await postAction(payload, opts.timeoutMs);
          if (!mountedRef.current) return null;
          const response = result && typeof result === 'object' ? result : { ok: true };
          if (response.ok === false) throw errorFromPayload(response, 'rejected');
          if (opts.note) {
            noteSeqRef.current += 1;
            setNote({ kind: 'success', message: opts.note, id: noteSeqRef.current });
          }
          const nextSnapshot = opts.refresh === false ? null : await fetchSnapshot({ force: true });
          if (typeof opts.after === 'function' && mountedRef.current) {
            try {
              await opts.after(response, nextSnapshot);
            } catch (afterError) {
              /* an after-hook must never mask the successful action */
            }
          }
          return response;
        } catch (err) {
          if (!mountedRef.current || isAbortError(err)) return null;
          setError({ source: 'action', ...classifyError(err), at: Date.now() });
          if (typeof opts.onError === 'function') {
            try {
              opts.onError(err);
            } catch (callbackError) {
              /* an error callback must not mask the action failure */
            }
          }
          return null;
        } finally {
          setBusyKey(key, false);
        }
      }, [fetchSnapshot, postAction, setBusyKey]);

      /** Refresh connections, platforms, sites and servers, then re-read the snapshot. */
      const refreshAll = useCallback(async (successNote) => {
        const key = 'all:refresh';
        if (busyMapRef.current[key]) return null;
        setBusyKey(key, true);
        setError((previous) => (previous && previous.source === 'action' ? null : previous));
        let failure = null;
        try {
          const results = await Promise.allSettled([
            postAction({ type: 'connections.refresh' }),
            postAction({ type: 'github.refresh' }),
            postAction({ type: 'cloudflare.refresh' }),
            postAction({ type: 'site.check' }),
            postAction({ type: 'server.check' }),
          ]);
          for (let i = 0; i < results.length; i += 1) {
            const result = results[i];
            if (result.status === 'rejected') {
              if (!isAbortError(result.reason)) {
                failure = result.reason;
                break;
              }
            } else if (result.value && result.value.ok === false) {
              failure = errorFromPayload(result.value, 'rejected');
              break;
            }
          }
          if (failure) {
            setError({ source: 'action', ...classifyError(failure), at: Date.now() });
          } else if (successNote && mountedRef.current) {
            noteSeqRef.current += 1;
            setNote({ kind: 'success', message: successNote, id: noteSeqRef.current });
          }
          await fetchSnapshot({ force: true });
          return failure ? null : { ok: true };
        } catch (err) {
          if (mountedRef.current && !isAbortError(err)) {
            setError({ source: 'action', ...classifyError(err), at: Date.now() });
          }
          return null;
        } finally {
          setBusyKey(key, false);
        }
      }, [fetchSnapshot, postAction, setBusyKey]);

      const dismissError = useCallback(() => setError(null), []);
      const clearNote = useCallback(() => setNote(null), []);
      const refresh = useCallback(() => fetchSnapshot({ force: true }), [fetchSnapshot]);

      // Poll every 2.5s while something is pending or an action is running,
      // otherwise every 15s. Paused while the document is hidden; failures
      // respect an exponential backoff window.
      const pending = isPendingSnapshot(snapshot) || Object.keys(busyMap).length > 0;
      useEffect(() => {
        const delay = pending ? POLL_ACTIVE_MS : POLL_IDLE_MS;
        const timer = setInterval(() => {
          if (typeof document !== 'undefined' && document.hidden) return;
          if (Date.now() < nextAttemptAtRef.current) return;
          void fetchSnapshot();
        }, delay);
        return () => clearInterval(timer);
      }, [pending, fetchSnapshot]);

      useEffect(() => {
        const onVisibilityChange = () => {
          if (typeof document !== 'undefined' && document.hidden) return;
          if (Date.now() < nextAttemptAtRef.current) return;
          void fetchSnapshot();
        };
        document.addEventListener('visibilitychange', onVisibilityChange);
        return () => document.removeEventListener('visibilitychange', onVisibilityChange);
      }, [fetchSnapshot]);

      return {
        snapshot,
        loading,
        error,
        note,
        busyMap,
        lastRefreshAt,
        pending,
        refresh,
        refreshAll,
        runAction,
        dismissError,
        clearNote,
        isBusy(key) {
          return Boolean(busyMap[key]);
        },
      };
    }

    // =========================================================================
    // Small interaction hooks
    // =========================================================================

    /** Two-click destructive confirm: armed for ~3s, then disarms itself. */
    function useTwoClickConfirm(timeoutMs) {
      const [armed, setArmed] = useState(false);
      const timerRef = useRef(null);
      const clearTimer = useCallback(() => {
        if (timerRef.current !== null) {
          clearTimeout(timerRef.current);
          timerRef.current = null;
        }
      }, []);
      useEffect(() => clearTimer, [clearTimer]);
      const arm = useCallback(() => {
        clearTimer();
        setArmed(true);
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          setArmed(false);
        }, typeof timeoutMs === 'number' ? timeoutMs : CONFIRM_TIMEOUT_MS);
      }, [clearTimer, timeoutMs]);
      const reset = useCallback(() => {
        clearTimer();
        setArmed(false);
      }, [clearTimer]);
      return { armed, arm, reset };
    }

    /** Clipboard write with a short copied/failed button state. */
    function useCopyFeedback() {
      const [status, setStatus] = useState('idle');
      const timerRef = useRef(null);
      const aliveRef = useRef(true);
      useEffect(() => {
        aliveRef.current = true;
        return () => {
          aliveRef.current = false;
          if (timerRef.current !== null) clearTimeout(timerRef.current);
        };
      }, []);
      const copy = useCallback(async (value) => {
        let nextStatus = 'copied';
        try {
          if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
            throw new Error('clipboard unavailable');
          }
          await navigator.clipboard.writeText(String(value));
        } catch (err) {
          nextStatus = 'failed';
        }
        if (!aliveRef.current) return;
        setStatus(nextStatus);
        if (timerRef.current !== null) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          if (aliveRef.current) setStatus('idle');
        }, 2000);
      }, []);
      return { status, copy };
    }

    // =========================================================================
    // Shared presentational primitives
    // =========================================================================

    /** Sidebar entry: terminal/monitor outline with a green status pulse. */
    function PanelIcon(props) {
      const size = props && isFiniteNumber(props.size) ? props.size : 18;
      return h('svg', {
        width: size,
        height: size,
        viewBox: '0 0 36 36',
        fill: 'none',
        'aria-hidden': 'true',
        focusable: 'false',
      },
      h('rect', {
        x: 3.5, y: 6, width: 29, height: 20, rx: 4,
        stroke: 'currentColor', strokeWidth: 2,
      }),
      h('path', {
        d: 'M13 30h10', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round',
      }),
      h('path', {
        d: 'M9 15l3.5 3L9 21', stroke: 'currentColor', strokeWidth: 2,
        strokeLinecap: 'round', strokeLinejoin: 'round',
      }),
      h('path', {
        d: 'M16 21h6', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round',
      }),
      h('circle', { cx: 30, cy: 9, r: 5.2, stroke: 'var(--dsw-alias-state-success-primary, #22C55E)', strokeOpacity: 0.35, strokeWidth: 1.5 }),
      h('circle', { cx: 30, cy: 9, r: 3.2, fill: 'var(--dsw-alias-state-success-primary, #22C55E)' }));
    }

    function CloseIcon() {
      return h('svg', {
        width: 14, height: 14, viewBox: '0 0 16 16', 'aria-hidden': 'true', focusable: 'false',
      }, h('path', {
        d: 'M4 4l8 8M12 4l-8 8', stroke: 'currentColor', strokeWidth: 1.6, strokeLinecap: 'round',
      }));
    }

    /** External link with a protocol allow-list; falls back to plain text. */
    function ExtLink(props) {
      const safe = safeExternalUrl(props.href);
      const className = mergeClasses('ops-link', props.className);
      if (!safe) {
        return h('span', { className: mergeClasses(className, 'ops-link-inert'), title: props.title }, props.children);
      }
      return h('a', {
        className,
        href: safe,
        target: '_blank',
        rel: 'noreferrer noopener',
        title: props.title,
      }, props.children);
    }

    function CopyButton(props) {
      const { t } = useI18n();
      const { status, copy } = useCopyFeedback();
      const label = status === 'copied' ? t('common.copied') : status === 'failed' ? t('common.copyFailed') : props.label || t('common.copy');
      return h('button', {
        type: 'button',
        className: mergeClasses('ops-btn', props.className),
        onClick: () => copy(props.value),
        disabled: props.disabled || typeof props.value !== 'string' || props.value === '',
        title: props.title || props.value,
      }, label);
    }

    function ConfirmButton(props) {
      const { t } = useI18n();
      const confirm = useTwoClickConfirm(props.timeoutMs);
      const busy = Boolean(props.busy);
      const armed = confirm.armed;
      return h('button', {
        type: 'button',
        className: mergeClasses('ops-btn ops-btn-danger', armed ? 'ops-btn-armed' : '', props.className),
        'aria-label': armed ? props.confirmLabel || t('common.confirmDelete') : props.label,
        title: props.title || (armed ? props.confirmLabel : props.label),
        disabled: props.disabled || busy,
        onClick: () => {
          if (confirm.armed) {
            confirm.reset();
            props.onConfirm();
          } else {
            confirm.arm();
          }
        },
      }, busy ? t('common.working') : armed ? props.confirmLabel || t('common.confirmDelete') : props.label);
    }

    function Switch(props) {
      return h('button', {
        type: 'button',
        role: 'switch',
        'aria-checked': props.checked ? 'true' : 'false',
        className: mergeClasses('ops-switch', props.className),
        onClick: () => props.onChange(!props.checked),
        disabled: props.disabled,
        title: props.title,
      },
      h('span', { className: 'ops-switch-track', 'aria-hidden': 'true' },
        h('span', { className: 'ops-switch-thumb' })),
      props.label ? h('span', { className: 'ops-switch-label' }, props.label) : null);
    }

    function Pill(props) {
      return h('span', {
        className: mergeClasses('ops-pill', 'ops-pill-' + (props.tone || 'idle'), props.className),
        'data-tone': props.tone || 'idle',
        title: props.title,
      }, props.children);
    }

    const SITE_STATUS_DESCRIPTIONS = {
      up: 'sites.statusUpDesc',
      degraded: 'sites.statusDegradedDesc',
      down: 'sites.statusDownDesc',
      unknown: 'sites.statusUnknownDesc',
    };

    function SiteStatePill(props) {
      const { t } = useI18n();
      const value = props.status || 'unknown';
      return h(Pill, {
        tone: siteTone(value),
        title: t(SITE_STATUS_DESCRIPTIONS[value] || 'sites.statusUnknownDesc'),
      }, statusLabel(t, value));
    }

    function SiteStatusLegend() {
      const { t } = useI18n();
      return h('details', { className: 'ops-legend' },
        h('summary', null, t('sites.statusLegend')),
        h('ul', { className: 'ops-legend-list' },
          h('li', null, h('strong', null, t('status.up')), ' — ', t('sites.statusUpDesc')),
          h('li', null, h('strong', null, t('status.degraded')), ' — ', t('sites.statusDegradedDesc')),
          h('li', null, h('strong', null, t('status.down')), ' — ', t('sites.statusDownDesc')),
          h('li', null, h('strong', null, t('status.unknown')), ' — ', t('sites.statusUnknownDesc'))));
    }

    function ServerStatePill(props) {
      const { t } = useI18n();
      const value = props.status || 'unknown';
      return h(Pill, { tone: serverTone(value) }, statusLabel(t, value));
    }

    function PlatformStatePill(props) {
      const { t } = useI18n();
      const value = props.state || 'idle';
      return h(Pill, { tone: platformTone(value) }, platformStateLabel(t, value));
    }

    function RunStatePill(props) {
      const { t } = useI18n();
      const value = props.value || 'unknown';
      return h(Pill, { tone: runTone(value) }, statusLabel(t, value));
    }

    function Field(props) {
      return h('label', { className: mergeClasses('ops-field', props.className) },
        h('span', { className: 'ops-field-label' }, props.label),
        props.children,
        props.hint ? h('span', { className: 'ops-field-hint' }, props.hint) : null);
    }

    function InlineError(props) {
      if (!props.children) return null;
      return h('div', { className: 'ops-inline-error', role: 'alert' }, props.children);
    }

    function EmptyState(props) {
      return h('div', { className: 'ops-empty' },
        h('strong', { className: 'ops-empty-title' }, props.title),
        props.children ? h('div', { className: 'ops-empty-text' }, props.children) : null,
        props.action || null);
    }

    function Card(props) {
      return h('section', { className: mergeClasses('ops-card', props.className) },
        props.title || props.actions
          ? h('div', { className: 'ops-card-head' },
            h('div', { className: 'ops-card-head-main' },
              props.title ? h('h3', { className: 'ops-card-title' }, props.title) : null,
              props.subtitle ? h('p', { className: 'ops-card-sub' }, props.subtitle) : null),
            props.actions ? h('div', { className: 'ops-card-actions' }, props.actions) : null)
          : null,
        h('div', { className: mergeClasses('ops-card-body', props.bodyClassName) }, props.children));
    }

    function Metric(props) {
      return h('div', { className: 'ops-metric' },
        h('span', { className: 'ops-metric-label' }, props.label),
        h('span', { className: mergeClasses('ops-metric-value', props.mono === false ? '' : 'ops-mono'), title: props.title }, props.value),
        props.hint ? h('span', { className: 'ops-metric-hint' }, props.hint) : null);
    }

    function Meter(props) {
      const percent = clampPercent(props.value);
      return h('div', {
        className: 'ops-meter',
        role: 'meter',
        'aria-valuemin': 0,
        'aria-valuemax': 100,
        'aria-valuenow': percent === null ? undefined : Math.round(percent),
        'aria-valuetext': percent === null ? undefined : Math.round(percent) + '%',
        title: props.title,
      }, h('span', {
        className: mergeClasses('ops-meter-fill', 'ops-meter-' + (props.tone || 'brand')),
        style: { width: (percent === null ? 0 : percent) + '%' },
      }));
    }

    function SkeletonPage(props) {
      return h('div', { className: 'ops-skeleton', 'aria-busy': 'true' },
        h('div', { className: 'ops-skeleton-line ops-skeleton-line-wide' }),
        h('div', { className: 'ops-skeleton-line ops-skeleton-line-narrow' }),
        h('div', { className: 'ops-skeleton-grid' },
          [0, 1, 2, 3, 4, 5].map((index) => h('div', { key: index, className: 'ops-skeleton-card' }))),
        h('div', { className: 'ops-skeleton-block' }),
        h('span', { className: 'ops-sr-only' }, props.t('common.loading')));
    }

    function ErrorBanner(props) {
      const { t } = useI18n();
      const error = props.error;
      if (!error) return null;
      let title;
      if (error.kind === 'auth') title = t('banner.authTitle');
      else if (error.kind === 'network') title = t('banner.networkTitle');
      else if (error.kind === 'timeout') title = t('banner.timeoutTitle');
      else title = error.source === 'snapshot' ? t('banner.loadingFailedTitle') : t('banner.actionTitle');
      let message;
      if (error.kind === 'network') message = t('banner.networkMessage');
      else if (error.kind === 'timeout') message = t('banner.timeoutMessage');
      else if (error.kind === 'auth') message = error.message || t('banner.authMessage');
      else message = error.message || t('banner.serverMessage');
      const defaultHint = error.kind === 'auth' ? t('banner.authHint')
        : error.kind === 'network' ? t('banner.networkHint')
          : error.kind === 'timeout' ? t('banner.timeoutHint') : '';
      const hint = error.hint || defaultHint;
      const retryText = error.source === 'snapshot' && isFiniteNumber(error.retryInMs)
        ? t('banner.autoRetry')
        : '';
      return h('div', { className: 'ops-banner ops-banner-error', role: 'alert' },
        h('div', { className: 'ops-banner-body' },
          h('strong', { className: 'ops-banner-title' }, title),
          h('p', { className: 'ops-banner-message' }, message),
          hint ? h('p', { className: 'ops-banner-hint' }, hint) : null,
          retryText ? h('p', { className: 'ops-banner-hint' }, retryText) : null),
        h('button', {
          type: 'button',
          className: 'ops-icon-btn',
          'aria-label': t('common.close'),
          title: t('common.close'),
          onClick: props.onDismiss,
        }, h(CloseIcon)));
    }

    /** Always-mounted polite live region for action results. */
    function LiveNote(props) {
      return h('div', { className: 'ops-live', role: 'status', 'aria-live': 'polite' },
        props.note
          ? h('span', { className: 'ops-note ops-note-' + (props.note.kind === 'success' ? 'success' : 'error') }, props.note.message)
          : null);
    }

    // =========================================================================
    // Overview tab
    // =========================================================================

    function StatCard(props) {
      return h('div', { className: 'ops-stat', 'data-tone': props.tone || 'idle' },
        h('span', { className: 'ops-stat-label' }, props.label),
        h('strong', { className: 'ops-stat-value' }, props.value),
        props.hint ? h('span', { className: 'ops-stat-hint' }, props.hint) : null);
    }

    function historySeries(history, key) {
      const points = [];
      const items = asArray(history);
      for (let i = 0; i < items.length; i += 1) {
        const value = items[i] ? items[i][key] : null;
        if (isFiniteNumber(value)) points.push({ x: i, y: value });
      }
      return points;
    }

    /** Inline SVG sparkline; no external chart library. */
    function HistoryChart(props) {
      const { t } = useI18n();
      const history = asArray(props.history);
      if (history.length < 2) return null;
      const definitions = [
        { key: 'localMs', label: t('sites.historyLegendLocal') },
        { key: 'cnMs', label: t('sites.historyLegendCn') },
        { key: 'globalMs', label: t('sites.historyLegendGlobal') },
      ];
      const series = definitions.map((definition) => ({
        key: definition.key,
        label: definition.label,
        points: historySeries(history, definition.key),
      }));
      const values = [];
      for (let i = 0; i < series.length; i += 1) {
        for (let j = 0; j < series[i].points.length; j += 1) values.push(series[i].points[j].y);
      }
      if (values.length < 2) return null;
      let min = values[0];
      let max = values[0];
      for (let i = 1; i < values.length; i += 1) {
        if (values[i] < min) min = values[i];
        if (values[i] > max) max = values[i];
      }
      const range = max - min || 1;
      const width = 240;
      const height = 54;
      const padX = 4;
      const padY = 6;
      const xFor = (index) => padX + (index / (history.length - 1)) * (width - padX * 2);
      const yFor = (value) => height - padY - ((value - min) / range) * (height - padY * 2);
      const rendered = [];
      for (let i = 0; i < series.length; i += 1) {
        const item = series[i];
        if (item.points.length >= 2) {
          rendered.push(h('polyline', {
            key: item.key,
            className: 'ops-spark-line ops-spark-' + item.key,
            points: item.points.map((point) => xFor(point.x).toFixed(1) + ',' + yFor(point.y).toFixed(1)).join(' '),
            fill: 'none',
          }));
        }
      }
      if (rendered.length === 0) return null;
      return h('div', { className: 'ops-history' },
        h('svg', {
          className: 'ops-spark',
          viewBox: '0 0 ' + width + ' ' + height,
          role: 'img',
          'aria-label': t('sites.historyTitle'),
        }, h('title', null, t('sites.historyTitle')), rendered),
        h('div', { className: 'ops-spark-legend' },
          series.map((item) => h('span', { key: item.key, className: 'ops-spark-legend-item' },
            h('span', { className: 'ops-spark-swatch ops-spark-' + item.key, 'aria-hidden': 'true' }),
            item.label))),
        h('span', { className: 'ops-spark-note' }, t('sites.historyPoints', { n: history.length })));
    }

    function nodeText(node) {
      if (!node) return '—';
      if (typeof node === 'string') return node;
      const parts = [];
      if (node.city) parts.push(String(node.city));
      if (node.country) parts.push(String(node.country));
      if (node.network) parts.push(String(node.network));
      return parts.length > 0 ? parts.join(' · ') : '—';
    }

    function failureText(failure) {
      if (failure === null || failure === undefined) return '—';
      if (typeof failure === 'string') return failure;
      if (typeof failure !== 'object') return String(failure);
      const parts = [];
      if (failure.city) parts.push(String(failure.city));
      if (failure.country) parts.push(String(failure.country));
      if (failure.network) parts.push(String(failure.network));
      const detail = failure.error || failure.message || failure.reason;
      if (detail) parts.push(typeof detail === 'string' ? detail : errorMessageText(detail));
      return parts.length > 0 ? parts.join(' · ') : JSON.stringify(failure);
    }

    /** One Globalping region group: summary, node table and failures. */
    function NodeGroup(props) {
      const { t } = useI18n();
      const group = asObject(props.group);
      const nodes = asArray(group.nodes);
      const failures = asArray(group.failures);
      const header = h('div', { className: 'ops-subhead' },
        h('h4', { className: 'ops-subtitle' }, props.title),
        h('span', { className: 'ops-muted ops-small' },
          t('sites.groupSummary', {
            total: numericText(group.total),
            success: numericText(group.success),
            failed: numericText(group.failed),
          })));
      if (group.error) {
        const hint = errorHintText(group.error);
        return h('div', { className: 'ops-subsection' }, header,
          h('p', { className: 'ops-inline-error' }, t('sites.groupError', { message: errorMessageText(group.error) })),
          hint ? h('p', { className: 'ops-muted ops-small' }, hint) : null);
      }
      if (group.skipped) {
        return h('div', { className: 'ops-subsection' }, header,
          h('p', { className: 'ops-muted' }, t('sites.groupSkipped')));
      }
      let tableBlock = null;
      if (nodes.length > 0) {
        const nodeRows = nodes.map((node, index) => {
          const ok = Boolean(node && node.ok);
          return h('tr', { key: index },
            h('td', null, node && node.city ? String(node.city) : '—'),
            h('td', null, node && node.country ? String(node.country) : '—'),
            h('td', null, node && node.network ? String(node.network) : '—'),
            h('td', { className: 'ops-mono' }, formatMs(t, node && node.totalMs)),
            h('td', null, ok
              ? h(Pill, { tone: 'success' }, t('status.ok'))
              : h(Pill, { tone: 'error' }, node && node.error ? errorMessageText(node.error) : t('status.error'))));
        });
        tableBlock = h('div', { className: 'ops-table-wrap' },
          h('table', { className: 'ops-table' },
            h('thead', null, h('tr', null,
              h('th', null, t('sites.tableNode')),
              h('th', null, t('sites.tableCountry')),
              h('th', null, t('sites.tableNetwork')),
              h('th', null, t('sites.tableLatency')),
              h('th', null, t('sites.tableResult')))),
            h('tbody', null, nodeRows)));
      } else {
        tableBlock = h('p', { className: 'ops-muted' }, t('sites.nodesEmpty'));
      }
      return h('div', { className: 'ops-subsection' },
        header,
        tableBlock,
        failures.length > 0
          ? h('div', { className: 'ops-failures' },
            h('span', { className: 'ops-failures-title' }, t('sites.failures')),
            h('ul', { className: 'ops-plain-list' },
              failures.map((failure, index) => h('li', { key: index }, failureText(failure)))))
          : null);
    }

    function RedirectChain(props) {
      const { t } = useI18n();
      const redirects = asArray(props.redirects);
      if (redirects.length === 0) {
        return h('p', { className: 'ops-muted' }, t('sites.redirectsEmpty'));
      }
      return h('div', { className: 'ops-table-wrap' },
        h('table', { className: 'ops-table' },
          h('thead', null, h('tr', null,
            h('th', null, t('sites.tableStep')),
            h('th', null, t('sites.tableUrl')),
            h('th', null, t('sites.tableStatus')),
            h('th', null, t('sites.tableLatency')))),
          h('tbody', null, redirects.map((redirect, index) => h('tr', { key: index },
            h('td', { className: 'ops-mono' }, String(index + 1)),
            h('td', { className: 'ops-cell-url' },
              h(ExtLink, { href: redirect && redirect.url, title: redirect && redirect.url },
                redirect && redirect.url ? String(redirect.url) : '—')),
            h('td', { className: 'ops-mono' }, redirect && isFiniteNumber(redirect.status) ? String(redirect.status) : '—'),
            h('td', { className: 'ops-mono' }, formatMs(t, redirect && redirect.ms)))))));
    }

    function DataSourceNote() {
      const { t } = useI18n();
      return h('div', { className: 'ops-source-note' },
        h('ul', { className: 'ops-plain-list ops-source-list' },
          h('li', null,
            h(ExtLink, { href: GLOBALPING_URL, className: 'ops-link' }, t('brand.globalping')),
            ' ',
            t('overview.sourceGlobalpingText')),
          h('li', null,
            h('strong', null, t('overview.sourceLocal')),
            ' ',
            t('overview.sourceLocalText')),
          h('li', null,
            h(ExtLink, { href: 'https://www.itdog.cn/', className: 'ops-link' }, t('brand.itdog')),
            ' ',
            t('overview.sourceItdogText')),
          h('li', null,
            h('strong', null, t('overview.sourceRun')),
            ' ',
            t('overview.sourceRunText'))));
    }

    function OverviewTab(props) {
      const { t, locale } = useI18n();
      const snapshot = props.snapshot || {};
      const allSites = asArray(snapshot.sites);
      const sites = allSites.filter((site) => site && site.enabled !== false);
      const servers = asArray(snapshot.servers);
      const now = props.now;
      const upCount = sites.filter((site) => site.last && site.last.status === 'up').length;
      const attention = sites.filter((site) => {
        const status = site && site.last ? site.last.status : null;
        return status === 'down' || status === 'degraded';
      });
      const issueCount = sites.filter((site) => {
        const status = site && site.last ? site.last.status : null;
        return status === 'down' || status === 'degraded';
      }).length;
      const cnValues = sites.map((site) => {
        const group = site && site.last ? asObject(site.last.cn) : {};
        return group.skipped ? null : group.medianMs;
      });
      const globalValues = sites.map((site) => {
        const group = site && site.last ? asObject(site.last.global) : {};
        return group.skipped ? null : group.medianMs;
      });
      const cnMedian = median(cnValues);
      const globalMedian = median(globalValues);
      const onlineServers = servers.filter((server) => server && server.last && (server.last.status === 'online' || server.last.status === 'warning')).length;
      const github = asObject(snapshot.github);
      const cloudflare = asObject(snapshot.cloudflare);
      const githubState = github.state || 'idle';
      const cloudflareState = cloudflare.state || 'idle';
      const githubLogin = github.account && github.account.login ? String(github.account.login) : '';
      const cloudflareName = cloudflare.account && (cloudflare.account.name || cloudflare.account.id)
        ? String(cloudflare.account.name || cloudflare.account.id) : '';

      const stats = [
        {
          key: 'sites',
          label: t('overview.statSites'),
          value: String(upCount) + ' / ' + String(sites.length),
          hint: t('overview.statSitesHint', { up: upCount, down: issueCount }),
          tone: issueCount > 0 ? 'warn' : sites.length > 0 ? 'success' : 'idle',
        },
        {
          key: 'cn',
          label: t('overview.statCnMedian'),
          value: formatMs(t, cnMedian),
          hint: t('overview.statMedianHint'),
          tone: cnMedian === null ? 'idle' : 'brand',
        },
        {
          key: 'global',
          label: t('overview.statGlobalMedian'),
          value: formatMs(t, globalMedian),
          hint: t('overview.statMedianHint'),
          tone: globalMedian === null ? 'idle' : 'brand',
        },
        {
          key: 'servers',
          label: t('overview.statServers'),
          value: String(onlineServers) + ' / ' + String(servers.length),
          hint: t('overview.statServersHint', { n: servers.length }),
          tone: servers.length === 0 ? 'idle' : onlineServers === servers.length ? 'success' : 'warn',
        },
        {
          key: 'github',
          label: t('overview.statGithub'),
          value: platformStateLabel(t, githubState),
          hint: githubLogin ? t('overview.statGithubHint', { login: githubLogin }) : t('overview.githubStateHint'),
          tone: platformTone(githubState),
        },
        {
          key: 'cloudflare',
          label: t('overview.statCloudflare'),
          value: platformStateLabel(t, cloudflareState),
          hint: cloudflareName ? t('overview.statCloudflareHint', { name: cloudflareName }) : t('overview.cloudflareStateHint'),
          tone: platformTone(cloudflareState),
        },
      ];

      return h('div', { className: 'ops-tab-body' },
        h('div', { className: 'ops-stats' },
          stats.map((stat) => h(StatCard, {
            key: stat.key,
            label: stat.label,
            value: stat.value,
            hint: stat.hint,
            tone: stat.tone,
          }))),
        h('div', { className: 'ops-cols' },
          h(Card, { title: t('overview.attention'), className: 'ops-col-main' },
            sites.length === 0
              ? h(EmptyState, { title: t('overview.noSitesTitle') },
                h('p', null, t('overview.attentionNoSites')))
              : attention.length === 0
                ? h(EmptyState, { title: t('overview.attentionEmpty') })
                : h('ul', { className: 'ops-attention-list' },
                  attention.map((site) => h('li', { key: site.id, className: 'ops-attention-item' },
                    h('div', { className: 'ops-attention-head' },
                      h('strong', { className: 'ops-attention-name' }, site.name || site.host || t('sites.unnamed')),
                      h(SiteStatePill, { status: site.last ? site.last.status : 'unknown' })),
                    h('div', { className: 'ops-attention-meta' },
                      h(ExtLink, {
                        href: site.url,
                        className: 'ops-link ops-small ops-mono',
                        title: site.url,
                      }, site.host || site.url || ''),
                      h('span', {
                        className: 'ops-muted ops-small',
                        title: formatAbsolute(locale, site.last && site.last.checkedAt),
                      }, formatRelative(t, site.last && site.last.checkedAt, now))),
                    asArray(site.last && site.last.reasons).length > 0
                      ? h('ul', { className: 'ops-reason-list' },
                        asArray(site.last.reasons).map((reason, index) => h('li', { key: index }, String(reason))))
                      : null)))),
          h(Card, {
            title: t('overview.dataSources'),
            className: 'ops-col-side',
          }, h(DataSourceNote))));
    }

    // =========================================================================
    // Sites tab
    // =========================================================================

    function KeyValueList(props) {
      return h('dl', { className: 'ops-kv' },
        props.rows.map((row) => h('div', { className: 'ops-kv-row', key: row.key },
          h('dt', null, row.label),
          h('dd', { className: row.mono === false ? '' : 'ops-mono' }, row.value))));
    }

    function DetailBlock(props) {
      return h('section', { className: 'ops-detail-block' },
        h('h4', { className: 'ops-subtitle' }, props.title),
        props.children);
    }

    function AddSiteForm(props) {
      const { t } = useI18n();
      const [name, setName] = useState('');
      const [url, setUrl] = useState('');
      const [formError, setFormError] = useState('');
      const busy = props.ops.isBusy('site.add');
      const onSubmit = async (event) => {
        event.preventDefault();
        if (busy) return;
        let value = url.trim();
        if (!value) {
          setFormError(t('sites.formUrlRequired'));
          return;
        }
        if (value.indexOf('://') === -1) value = 'https://' + value;
        if (!isHttpUrl(value)) {
          setFormError(t('sites.formUrlInvalid'));
          return;
        }
        setFormError('');
        const payload = { type: 'site.add', url: value };
        const trimmedName = name.trim();
        if (trimmedName) payload.name = trimmedName;
        const result = await props.ops.runAction('site.add', payload, {
          note: t('notes.siteAdded'),
          after: async (response, nextSnapshot) => {
            const id = response && response.id ? String(response.id) : '';
            if (!id) return;
            const created = asArray(nextSnapshot && nextSnapshot.sites).find((site) => site && String(site.id) === id);
            if (created && !created.pending && !created.last) {
              await props.ops.runAction('site.check:' + id, { type: 'site.check', id }, {
                note: t('notes.siteChecked'),
              });
            }
          },
        });
        if (result) {
          setName('');
          setUrl('');
        }
      };
      return h(Card, { title: t('sites.addTitle') },
        h('form', { className: 'ops-form', onSubmit, noValidate: true },
          h(Field, {
            label: t('sites.nameLabel'),
            className: 'ops-field-grow',
          }, h('input', {
            className: 'ops-input',
            type: 'text',
            value: name,
            placeholder: t('sites.namePlaceholder'),
            onChange: (event) => setName(event.target.value),
            disabled: busy,
            maxLength: 80,
          })),
          h(Field, {
            label: t('sites.urlLabel'),
            className: 'ops-field-grow-2',
          }, h('input', {
            className: 'ops-input',
            type: 'text',
            inputMode: 'url',
            value: url,
            placeholder: t('sites.urlPlaceholder'),
            onChange: (event) => setUrl(event.target.value),
            disabled: busy,
            autoComplete: 'off',
            spellCheck: false,
          })),
          h('button', {
            type: 'submit',
            className: 'ops-btn ops-btn-primary',
            disabled: busy,
          }, busy ? t('sites.addBusy') : t('sites.addSubmit'))),
        h(InlineError, null, formError));
    }

    function SiteMetrics(props) {
      const { t } = useI18n();
      const site = props.site;
      const last = asObject(site.last);
      const local = asObject(last.local);
      const timings = asObject(local.timings);
      const cn = asObject(last.cn);
      const globalGroup = asObject(last.global);
      const tls = asObject(local.tls);
      const localMedian = median(asArray(site.history).map((point) => point && point.localMs));
      const localValue = localMedian === null ? timings.totalMs : localMedian;
      return h('div', { className: 'ops-metrics' },
        h(Metric, { label: t('sites.uptime'), value: formatPercent(site.uptimePct, 1) }),
        h(Metric, { label: t('sites.localMedian'), value: formatMs(t, localValue) }),
        h(Metric, { label: t('sites.cnMedian'), value: formatMs(t, cn.medianMs), hint: cn.skipped ? t('sites.groupSkipped') : '' }),
        h(Metric, { label: t('sites.globalMedian'), value: formatMs(t, globalGroup.medianMs), hint: globalGroup.skipped ? t('sites.groupSkipped') : '' }),
        h(Metric, {
          label: t('sites.tlsDays'),
          value: isFiniteNumber(tls.daysLeft) ? t('sites.daysValue', { n: Math.round(tls.daysLeft) }) : t('common.none'),
        }),
        h(Metric, {
          label: t('sites.lastChecked'),
          value: formatRelative(t, last.checkedAt, props.now),
          title: formatAbsolute(props.locale, last.checkedAt),
        }));
    }

    function SiteDetails(props) {
      const { t, locale } = useI18n();
      const site = props.site;
      const last = asObject(site.last);
      const history = asArray(site.history);
      const local = asObject(last.local);
      const timings = asObject(local.timings);
      const tls = asObject(local.tls);
      const reasons = asArray(last.reasons);
      const hasProbe = Boolean(last.checkedAt) || Boolean(local.status) || Boolean(local.error);
      return h('div', { className: 'ops-details' },
        last.error ? h('div', { className: 'ops-error-block' },
          h('h4', { className: 'ops-subtitle' }, t('sites.globalError')),
          h('p', { className: 'ops-inline-error' }, errorMessageText(last.error)),
          errorHintText(last.error) ? h('p', { className: 'ops-muted ops-small' }, errorHintText(last.error)) : null) : null,
        reasons.length > 0
          ? h('div', { className: 'ops-reasons' },
            h('span', { className: 'ops-failures-title' }, t('sites.reasons')),
            h('ul', { className: 'ops-reason-list' },
              reasons.map((reason, index) => h('li', { key: index }, String(reason)))))
          : null,
        h('div', { className: 'ops-details-grid' },
          h(DetailBlock, { title: t('sites.localTitle') },
            hasProbe
              ? h('div', null,
                h(KeyValueList, {
                  rows: [
                    {
                      key: 'status',
                      label: t('sites.localStatus'),
                      value: isFiniteNumber(local.status)
                        ? String(local.status) + (local.statusText ? ' ' + String(local.statusText) : '')
                        : t('common.none'),
                    },
                    {
                      key: 'finalUrl',
                      label: t('sites.finalUrl'),
                      value: local.finalUrl
                        ? h(ExtLink, { href: local.finalUrl, className: 'ops-link', title: String(local.finalUrl) }, String(local.finalUrl))
                        : t('common.none'),
                      mono: false,
                    },
                    {
                      key: 'reachable',
                      label: t('sites.reachable'),
                      value: local.reachable === false ? t('common.no') : local.ok ? t('common.yes') : t('common.none'),
                      mono: false,
                    },
                    { key: 'body', label: t('sites.bodyBytes'), value: formatBytes(local.bodyBytes) },
                  ],
                }),
                h('div', { className: 'ops-timing-block' },
                  h('span', { className: 'ops-failures-title' }, t('sites.timings')),
                  h(KeyValueList, {
                    rows: [
                      { key: 'dns', label: t('sites.dns'), value: formatMs(t, timings.dnsMs) },
                      { key: 'tcp', label: t('sites.tcp'), value: formatMs(t, timings.tcpMs) },
                      { key: 'tls', label: t('sites.tls'), value: formatMs(t, timings.tlsMs) },
                      { key: 'ttfb', label: t('sites.ttfb'), value: formatMs(t, timings.ttfbMs) },
                      { key: 'total', label: t('sites.total'), value: formatMs(t, timings.totalMs) },
                    ],
                  })),
                local.error
                  ? h('div', { className: 'ops-error-block' },
                    h('p', { className: 'ops-inline-error' }, errorMessageText(local.error)),
                    errorHintText(local.error) ? h('p', { className: 'ops-muted ops-small' }, errorHintText(local.error)) : null)
                  : null,
                local.truncated ? h('p', { className: 'ops-muted ops-small' }, t('common.tooLong')) : null)
              : h('p', { className: 'ops-muted' }, t('sites.noProbe'))),
          h(DetailBlock, { title: t('sites.tlsTitle') },
            local.tls
              ? h(KeyValueList, {
                rows: [
                  {
                    key: 'valid',
                    label: t('sites.tlsValid'),
                    value: h(Pill, { tone: tls.valid ? 'success' : 'error' },
                      tls.valid ? t('status.valid') : t('status.invalid')),
                    mono: false,
                  },
                  {
                    key: 'days',
                    label: t('sites.tlsDays'),
                    value: isFiniteNumber(tls.daysLeft) ? t('sites.daysValue', { n: Math.round(tls.daysLeft) }) : t('common.none'),
                  },
                  { key: 'protocol', label: t('sites.tlsProtocol'), value: tls.protocol ? String(tls.protocol) : t('common.none') },
                  { key: 'issuer', label: t('sites.tlsIssuer'), value: tls.issuer ? String(tls.issuer) : t('common.none'), mono: false },
                ],
              })
              : h('p', { className: 'ops-muted' }, t('sites.noProbe')),
            tls.error ? h('p', { className: 'ops-inline-error' }, errorMessageText(tls.error)) : null)),
        h(DetailBlock, { title: t('sites.redirectTitle') }, h(RedirectChain, { redirects: local.redirects })),
        h('div', { className: 'ops-details-grid' },
          h(DetailBlock, { title: t('sites.cnNodes') }, h(NodeGroup, { group: last.cn })),
          h(DetailBlock, { title: t('sites.globalNodes') }, h(NodeGroup, { group: last.global }))),
        h(DetailBlock, { title: t('sites.historyTitle') },
          history.length >= 2
            ? h(HistoryChart, { history })
            : h('p', { className: 'ops-muted' }, t('sites.noHistory'))),
        h('p', { className: 'ops-muted ops-small' },
          t('sites.lastChecked') + ' · ' + formatRelative(t, last.checkedAt, props.now) + ' · ' + formatAbsolute(locale, last.checkedAt)));
    }

    function SiteCard(props) {
      const { t } = useI18n();
      const site = props.site;
      const id = String(site.id);
      const [expanded, setExpanded] = useState(false);
      const busyCheck = props.ops.isBusy('site.check:' + id);
      const busyToggle = props.ops.isBusy('site.setEnabled:' + id);
      const busyRemove = props.ops.isBusy('site.remove:' + id);
      const status = site.last ? site.last.status : 'unknown';
      const host = site.host || hostFromUrl(site.url) || '';
      const itdogHref = host ? ITDOG_BASE + encodeURIComponent(host) + '?auto_submit=1' : '';
      const displayUrl = site.url ? String(site.url) : host;
      const last = asObject(site.last);
      const checkNow = () => props.ops.runAction('site.check:' + id, { type: 'site.check', id }, {
        note: t('notes.siteChecked'),
      });
      const remove = () => props.ops.runAction('site.remove:' + id, { type: 'site.remove', id }, {
        note: t('notes.siteRemoved'),
      });
      const toggle = (next) => props.ops.runAction('site.setEnabled:' + id, { type: 'site.setEnabled', id, enabled: next }, {
        note: t('notes.siteToggled'),
      });
      return h('article', {
        className: 'ops-card ops-item-card',
        'data-status': status,
      },
      h('div', { className: 'ops-item-head' },
        h('div', { className: 'ops-item-title-wrap' },
          h('div', { className: 'ops-item-title-row' },
            h('strong', { className: 'ops-item-title' }, site.name || host || t('sites.unnamed')),
            h(SiteStatePill, { status }),
            site.enabled === false ? h(Pill, { tone: 'idle' }, t('common.disabled')) : null),
          h('div', { className: 'ops-item-sub' },
            h(ExtLink, { href: site.url, className: 'ops-link ops-mono ops-url', title: displayUrl }, displayUrl || t('common.none')),
            h('span', { className: 'ops-dot-sep', 'aria-hidden': 'true' }),
            h('span', {
              className: 'ops-muted ops-small',
              title: formatAbsolute(props.locale, last.checkedAt),
            }, t('sites.lastChecked') + ' ' + formatRelative(t, last.checkedAt, props.now)))),
        h('div', { className: 'ops-item-actions' },
          h(Switch, {
            checked: site.enabled !== false,
            onChange: toggle,
            disabled: busyToggle || busyRemove,
            label: site.enabled !== false ? t('common.enabled') : t('common.disabled'),
            title: t('sites.toggleEnabled'),
          }),
          h('button', {
            type: 'button',
            className: 'ops-btn ops-btn-primary',
            onClick: checkNow,
            disabled: busyCheck || busyRemove,
          }, busyCheck ? t('common.checking') : t('common.checkNow')),
          h('button', {
            type: 'button',
            className: 'ops-btn',
            'aria-expanded': expanded ? 'true' : 'false',
            onClick: () => setExpanded((value) => !value),
          }, expanded ? t('common.collapse') : t('common.details')),
          itdogHref
            ? h('a', {
              className: 'ops-btn',
              href: itdogHref,
              target: '_blank',
              rel: 'noreferrer noopener',
              title: t('sites.itdog'),
            }, t('sites.itdog'))
            : null,
          h(CopyButton, { value: host, label: t('sites.copyHost') }),
          h(ConfirmButton, {
            label: t('common.delete'),
            confirmLabel: t('common.confirmDelete'),
            onConfirm: remove,
            busy: busyRemove,
            disabled: busyCheck,
            title: t('sites.deleteConfirm'),
          }))),
      h(SiteMetrics, { site, now: props.now, locale: props.locale }),
      (status === 'degraded' || status === 'down') && asArray(last.reasons).length > 0
        ? h('p', { className: 'ops-status-reasons' },
          t('sites.reasons') + ': ' + asArray(last.reasons).slice(0, 2).join(' · '))
        : null,
      site.enabled === false ? h('p', { className: 'ops-muted ops-small' }, t('sites.disabledNote')) : null,
      expanded ? h(SiteDetails, { site, now: props.now, locale: props.locale }) : null);
    }

    function SitesTab(props) {
      const { t } = useI18n();
      const sites = asArray(props.snapshot && props.snapshot.sites);
      const upCount = sites.filter((site) => site && site.last && site.last.status === 'up').length;
      const issueCount = sites.filter((site) => site && site.last && (site.last.status === 'down' || site.last.status === 'degraded')).length;
      const busyAll = props.ops.isBusy('site.check:all');
      return h('div', { className: 'ops-tab-body' },
        h(AddSiteForm, { ops: props.ops }),
        h('p', { className: 'ops-form-hint' }, t('sites.statusHint')),
        h(SiteStatusLegend),
        h('div', { className: 'ops-toolbar' },
          h('span', { className: 'ops-muted' },
            t('sites.countLabel', { n: sites.length, up: upCount, issue: issueCount })),
          h('button', {
            type: 'button',
            className: 'ops-btn',
            disabled: busyAll,
            onClick: () => props.ops.runAction('site.check:all', { type: 'site.check' }, {
              note: t('notes.checkAllStarted'),
            }),
          }, busyAll ? t('sites.checkingAll') : t('sites.checkAll'))),
        sites.length === 0
          ? h(EmptyState, { title: t('sites.emptyTitle') }, h('p', null, t('sites.emptyText')))
          : h('div', { className: 'ops-list' },
            sites.map((site) => h(SiteCard, {
              key: site.id,
              site,
              ops: props.ops,
              now: props.now,
              locale: props.locale,
            }))));
    }

    // =========================================================================
    // Servers tab
    // =========================================================================

    function MeterMetric(props) {
      const percent = clampPercent(props.value);
      return h('div', { className: 'ops-metric ops-meter-metric' },
        h('span', { className: 'ops-metric-label' }, props.label),
        h('span', { className: 'ops-metric-value ops-mono' }, formatPercent(percent, 0)),
        h(Meter, { value: percent, tone: props.tone, title: props.title }),
        props.hint ? h('span', { className: 'ops-metric-hint' }, props.hint) : null);
    }

    function ServerKeyHelp(props) {
      const { t } = useI18n();
      const target = String(props.target || '').trim() || '<别名或 user@host>';
      const rows = [
        { command: 'ls -la ~/.ssh', label: t('servers.keyHelpList') },
        { command: 'ssh-add -l', label: t('servers.keyHelpAgent') },
        { command: 'ssh -G ' + target, label: t('servers.keyHelpConfig') },
        { command: 'ssh-add ~/.ssh/id_ed25519', label: t('servers.keyHelpManage') },
        { command: 'chmod 600 ~/.ssh/id_ed25519', label: t('servers.keyHelpPermissions') },
      ];
      return h('details', { className: 'ops-legend ops-key-help' },
        h('summary', null, t('servers.keyHelpTitle')),
        h('p', { className: 'ops-legend-text' }, t('servers.keyHelpIntro')),
        rows.map((row, index) => h('div', { key: index, className: 'ops-help-row' },
          h('span', { className: 'ops-muted ops-small' }, row.label),
          h('div', { className: 'ops-code-row' },
            h('code', { className: 'ops-code ops-help-command' }, row.command),
            h(CopyButton, { value: row.command, label: t('servers.copyCommand') })))),
        h('p', { className: 'ops-muted ops-small' }, t('servers.keyHelpNote')));
    }

    function AddServerForm(props) {
      const { t } = useI18n();
      const [label, setLabel] = useState('');
      const [target, setTarget] = useState('');
      const [user, setUser] = useState('');
      const [port, setPort] = useState('');
      const [identityFile, setIdentityFile] = useState('');
      const [formError, setFormError] = useState('');
      const [pickError, setPickError] = useState('');
      const busy = props.ops.isBusy('server.add');
      const busyPick = props.ops.isBusy('server.pickKey');
      const pickKey = async () => {
        setPickError('');
        const result = await props.ops.runAction('server.pickKey', { type: 'server.pickKey' }, {
          timeoutMs: 180000,
          onError: (err) => setPickError([err && err.message, err && err.hint].filter(Boolean).join(' — ')),
        });
        if (result && typeof result.path === 'string' && result.path !== '') setIdentityFile(result.path);
      };
      const onSubmit = async (event) => {
        event.preventDefault();
        if (busy) return;
        const trimmedTarget = target.trim();
        if (!trimmedTarget) {
          setFormError(t('servers.targetRequired'));
          return;
        }
        const portText = String(port).trim();
        let portNumber = null;
        if (portText !== '') {
          portNumber = Number(portText);
          if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
            setFormError(t('servers.portInvalid'));
            return;
          }
        }
        setFormError('');
        const result = await props.ops.runAction('server.add', {
          type: 'server.add',
          label: label.trim(),
          target: trimmedTarget,
          user: user.trim(),
          port: portNumber,
          identityFile: identityFile.trim(),
        }, { note: t('notes.serverAdded') });
        if (result) {
          setLabel('');
          setTarget('');
          setUser('');
          setPort('');
          setIdentityFile('');
        }
      };
      return h(Card, { title: t('servers.addTitle') },
        h('form', { className: 'ops-form', onSubmit, noValidate: true },
          h(Field, { label: t('servers.labelLabel'), className: 'ops-field-grow' },
            h('input', {
              className: 'ops-input',
              type: 'text',
              value: label,
              placeholder: t('servers.labelPlaceholder'),
              onChange: (event) => setLabel(event.target.value),
              disabled: busy,
              maxLength: 80,
            })),
          h(Field, { label: t('servers.targetLabel'), className: 'ops-field-grow-2' },
            h('input', {
              className: 'ops-input',
              type: 'text',
              value: target,
              placeholder: t('servers.targetPlaceholder'),
              onChange: (event) => setTarget(event.target.value),
              disabled: busy,
              autoComplete: 'off',
              spellCheck: false,
            })),
          h(Field, { label: t('servers.userLabel'), className: 'ops-field-narrow' },
            h('input', {
              className: 'ops-input',
              type: 'text',
              value: user,
              placeholder: t('servers.userPlaceholder'),
              onChange: (event) => setUser(event.target.value),
              disabled: busy,
              autoComplete: 'off',
              spellCheck: false,
            })),
          h(Field, { label: t('servers.portLabel'), className: 'ops-field-tiny' },
            h('input', {
              className: 'ops-input',
              type: 'number',
              min: 1,
              max: 65535,
              value: port,
              onChange: (event) => setPort(event.target.value),
              disabled: busy,
              inputMode: 'numeric',
            })),
          h(Field, { label: t('servers.identityLabel'), className: 'ops-field-grow-2' },
            h('div', { className: 'ops-input-with-button' },
              h('input', {
                className: 'ops-input',
                type: 'text',
                value: identityFile,
                placeholder: t('servers.identityPlaceholder'),
                onChange: (event) => setIdentityFile(event.target.value),
                disabled: busy || busyPick,
                autoComplete: 'off',
                spellCheck: false,
              }),
              h('button', {
                type: 'button',
                className: 'ops-btn',
                onClick: pickKey,
                disabled: busy || busyPick,
              }, busyPick ? t('servers.pickKeyBusy') : t('servers.pickKey')))),
          h('button', {
            type: 'submit',
            className: 'ops-btn ops-btn-primary',
            disabled: busy,
          }, busy ? t('servers.addBusy') : t('servers.addSubmit'))),
        h('p', { className: 'ops-form-hint' }, t('servers.formHint')),
        h(InlineError, null, formError),
        h(InlineError, null, pickError),
        h(ServerKeyHelp, { target }));
    }

    function ServerMetrics(props) {
      const { t } = useI18n();
      const last = asObject(props.server.last);
      const load = asArray(last.load);
      const memory = asObject(last.memory);
      const disk = asObject(last.disk);
      const memoryPercent = clampPercent(memory.usedPct);
      const diskPercent = clampPercent(disk.usedPct);
      return h('div', { className: 'ops-metrics' },
        h(Metric, { label: t('servers.duration'), value: formatMs(t, last.durationMs) }),
        h(Metric, {
          label: t('servers.hostname'),
          value: last.hostname ? String(last.hostname) : t('common.none'),
          title: last.kernel ? String(last.kernel) : '',
        }),
        h(Metric, { label: t('servers.os'), value: last.os ? String(last.os) : t('common.none'), hint: last.kernel ? String(last.kernel) : '' }),
        h(Metric, { label: t('servers.uptime'), value: formatUptime(t, last.uptimeSeconds) }),
        h(Metric, {
          label: t('servers.load'),
          value: load.length >= 3
            ? t('servers.loadValue', {
              l1: numericText(load[0]),
              l5: numericText(load[1]),
              l15: numericText(load[2]),
            })
            : t('common.none'),
          hint: isFiniteNumber(last.cores) ? t('servers.coresHint', { n: last.cores }) : '',
        }),
        h(MeterMetric, {
          label: t('servers.memory'),
          value: memoryPercent,
          tone: memoryPercent !== null && memoryPercent >= 90 ? 'error' : memoryPercent !== null && memoryPercent >= 75 ? 'warn' : 'success',
          hint: isFiniteNumber(memory.totalBytes)
            ? formatBytes(memory.totalBytes)
            : '',
        }),
        h(MeterMetric, {
          label: t('servers.disk'),
          value: diskPercent,
          tone: diskPercent !== null && diskPercent >= 90 ? 'error' : diskPercent !== null && diskPercent >= 75 ? 'warn' : 'success',
          hint: isFiniteNumber(disk.totalBytes) ? formatBytes(disk.totalBytes) : '',
        }),
        h(Metric, {
          label: t('servers.failedUnits'),
          value: isFiniteNumber(last.failedUnits) ? t('servers.failedUnitsValue', { n: last.failedUnits }) : t('common.none'),
          hint: isFiniteNumber(last.failedUnits) && last.failedUnits > 0 ? t('servers.failedUnitsHint') : '',
        }),
        h(Metric, {
          label: t('servers.docker'),
          value: isFiniteNumber(last.dockerContainers) ? t('servers.dockerValue', { n: last.dockerContainers }) : t('common.none'),
        }),
        h(Metric, {
          label: t('servers.lastChecked'),
          value: formatRelative(t, last.checkedAt, props.now),
          title: formatAbsolute(props.locale, last.checkedAt),
        }));
    }

    function SshErrorCommand(props) {
      const { t } = useI18n();
      const error = asObject(props.error);
      if (typeof error.command !== 'string' || error.command === '') return null;
      return h('div', { className: 'ops-ssh-command' },
        h('p', { className: 'ops-muted ops-small' }, error.commandHint || t('servers.verifyCommandHint')),
        h('div', { className: 'ops-code-row' },
          h('code', { className: 'ops-code ops-help-command', title: error.command }, error.command),
          h(CopyButton, { value: error.command, label: t('common.copy') })));
    }

    function ServerDetails(props) {
      const { t, locale } = useI18n();
      const last = asObject(props.server.last);
      const warnings = asArray(last.warnings);
      return h('div', { className: 'ops-details' },
        last.error ? h('div', { className: 'ops-error-block' },
          h('h4', { className: 'ops-subtitle' }, t('servers.errorTitle')),
          h('p', { className: 'ops-inline-error' }, errorMessageText(last.error)),
          h('p', { className: 'ops-muted ops-small' }, errorHintText(last.error) || t('servers.sshHint')),
          h(SshErrorCommand, { error: last.error })) : null,
        warnings.length > 0
          ? h('div', { className: 'ops-error-block' },
            h('h4', { className: 'ops-subtitle' }, t('servers.warnings')),
            h('ul', { className: 'ops-reason-list' },
              warnings.map((warning, index) => h('li', { key: index },
                typeof warning === 'string' ? warning : errorMessageText(warning)))))
          : null,
        h('section', { className: 'ops-detail-block' },
          h('div', { className: 'ops-subhead' },
            h('h4', { className: 'ops-subtitle' }, t('servers.rawTitle')),
            h('span', { className: 'ops-muted ops-small' },
              formatAbsolute(locale, last.checkedAt))),
          last.raw
            ? h('pre', { className: 'ops-pre' }, String(last.raw))
            : h('p', { className: 'ops-muted' }, t('servers.rawEmpty'))));
    }

    function ServerCard(props) {
      const { t } = useI18n();
      const server = props.server;
      const id = String(server.id);
      const [expanded, setExpanded] = useState(false);
      const busyCheck = props.ops.isBusy('server.check:' + id);
      const busyRemove = props.ops.isBusy('server.remove:' + id);
      const last = asObject(server.last);
      const status = last.status || '';
      const targetText = (server.user ? String(server.user) + '@' : '')
        + (server.target ? String(server.target) : '—')
        + (isFiniteNumber(server.port) ? ':' + String(server.port) : '');
      const checkNow = () => props.ops.runAction('server.check:' + id, { type: 'server.check', id }, {
        note: t('notes.serverChecked'),
      });
      const remove = () => props.ops.runAction('server.remove:' + id, { type: 'server.remove', id }, {
        note: t('notes.serverRemoved'),
      });
      return h('article', { className: 'ops-card ops-item-card', 'data-status': status || 'unknown' },
        h('div', { className: 'ops-item-head' },
          h('div', { className: 'ops-item-title-wrap' },
            h('div', { className: 'ops-item-title-row' },
              h('strong', { className: 'ops-item-title' },
                server.label || server.target || server.id),
              last.checkedAt
                ? h(ServerStatePill, { status })
                : h(Pill, { tone: 'idle' }, t('servers.neverChecked')),
              server.enabled === false ? h(Pill, { tone: 'idle' }, t('common.disabled')) : null),
            h('div', { className: 'ops-item-sub' },
              h('span', { className: 'ops-mono ops-small' }, targetText),
              h('span', { className: 'ops-dot-sep', 'aria-hidden': 'true' }),
              h('span', {
                className: 'ops-muted ops-small',
                title: formatAbsolute(props.locale, last.checkedAt),
              }, t('servers.lastChecked') + ' ' + formatRelative(t, last.checkedAt, props.now)))),
          h('div', { className: 'ops-item-actions' },
            h('button', {
              type: 'button',
              className: 'ops-btn ops-btn-primary',
              onClick: checkNow,
              disabled: busyCheck || busyRemove,
            }, busyCheck ? t('common.checking') : t('common.checkNow')),
            h('button', {
              type: 'button',
              className: 'ops-btn',
              'aria-expanded': expanded ? 'true' : 'false',
              onClick: () => setExpanded((value) => !value),
            }, expanded ? t('common.collapse') : t('common.details')),
            h(ConfirmButton, {
              label: t('common.delete'),
              confirmLabel: t('common.confirmDelete'),
              onConfirm: remove,
              busy: busyRemove,
              disabled: busyCheck,
              title: t('servers.deleteConfirm'),
            }))),
        last.checkedAt
          ? (last.status === 'offline' && last.error
            ? h('div', { className: 'ops-metrics' },
              h(Metric, { label: t('servers.duration'), value: formatMs(t, last.durationMs) }),
              h(Metric, { label: t('servers.lastChecked'), value: formatRelative(t, last.checkedAt, props.now) }))
            : h(ServerMetrics, { server, now: props.now, locale: props.locale }))
          : h('p', { className: 'ops-muted' }, t('servers.sshHint')),
        last.error && !expanded
          ? h('div', { className: 'ops-inline-error ops-small' },
            h('p', null, errorMessageText(last.error)),
            h(SshErrorCommand, { error: last.error }))
          : null,
        server.identityFile
          ? h('p', { className: 'ops-muted ops-small' },
            t('servers.identityNote', { path: String(server.identityFile) }))
          : null,
        expanded ? h(ServerDetails, { server, now: props.now, locale: props.locale }) : null);
    }

    function ServersTab(props) {
      const { t } = useI18n();
      const servers = asArray(props.snapshot && props.snapshot.servers);
      const online = servers.filter((server) => server && server.last && (server.last.status === 'online' || server.last.status === 'warning')).length;
      const busyAll = props.ops.isBusy('server.check:all');
      return h('div', { className: 'ops-tab-body' },
        h(AddServerForm, { ops: props.ops }),
        h('div', { className: 'ops-toolbar' },
          h('span', { className: 'ops-muted' }, t('servers.countLabel', { n: servers.length, online })),
          h('button', {
            type: 'button',
            className: 'ops-btn',
            disabled: busyAll,
            onClick: () => props.ops.runAction('server.check:all', { type: 'server.check' }, {
              note: t('notes.checkAllStarted'),
            }),
          }, busyAll ? t('servers.checkingAll') : t('servers.checkAll'))),
        servers.length === 0
          ? h(EmptyState, { title: t('servers.emptyTitle') }, h('p', null, t('servers.emptyText')))
          : h('div', { className: 'ops-list' },
            servers.map((server) => h(ServerCard, {
              key: server.id,
              server,
              ops: props.ops,
              now: props.now,
              locale: props.locale,
            }))));
    }

    // =========================================================================
    // Platforms tab: GitHub and Cloudflare
    // =========================================================================

    function errorMessageText(value) {
      if (value === null || value === undefined || value === '') return '';
      if (typeof value === 'string') return value;
      if (typeof value === 'object') {
        if (typeof value.message === 'string') return value.message;
        if (typeof value.error === 'string') return value.error;
        if (value.error) return errorMessageText(value.error);
        try {
          return JSON.stringify(value);
        } catch (err) {
          return String(value);
        }
      }
      return String(value);
    }

    function errorHintText(value) {
      if (value && typeof value === 'object' && typeof value.hint === 'string') return value.hint;
      return '';
    }

    function HintBlock(props) {
      return h('div', { className: 'ops-hint-block' },
        h('p', null, props.text),
        props.code ? h('code', { className: 'ops-code' }, props.code) : null);
    }

    function PlatformStateHint(props) {
      const { t } = useI18n();
      const prefix = props.kind === 'github' ? 'github' : 'cloudflare';
      if (props.state === 'connected') return null;
      if (props.state === 'not-installed') {
        return h(HintBlock, {
          text: t('platforms.' + prefix + 'NotInstalled'),
          code: t('platforms.' + prefix + 'NotInstalledHint'),
        });
      }
      if (props.state === 'not-authenticated') {
        return h(HintBlock, {
          text: t('platforms.' + prefix + 'NotAuthenticated'),
          code: t('platforms.' + prefix + 'NotAuthenticatedHint'),
        });
      }
      if (props.state === 'error') {
        return h(HintBlock, { text: t('platforms.' + prefix + 'ErrorHint') });
      }
      if (props.state === 'checking') {
        return h('p', { className: 'ops-muted' }, t('platforms.' + prefix + 'Checking'));
      }
      return h('p', { className: 'ops-muted' }, t('platforms.' + prefix + 'Idle'));
    }

    function normalizeRepoInput(value) {
      let text = String(value || '').trim();
      text = text.replace(/^https?:\/\/github\.com\//i, '');
      text = text.replace(/\.git$/i, '');
      text = text.replace(/\/+$/, '');
      const parts = text.split('/');
      if (parts.length !== 2) return '';
      if (!parts[0] || !parts[1]) return '';
      if (/\s/.test(text)) return '';
      return parts[0] + '/' + parts[1];
    }

    function AddRepoForm(props) {
      const { t } = useI18n();
      const [value, setValue] = useState('');
      const [formError, setFormError] = useState('');
      const busy = props.ops.isBusy('github.repo.add');
      const onSubmit = async (event) => {
        event.preventDefault();
        if (busy) return;
        const repo = normalizeRepoInput(value);
        if (!repo) {
          setFormError(t('platforms.githubAddInvalid'));
          return;
        }
        setFormError('');
        const result = await props.ops.runAction('github.repo.add', { type: 'github.repo.add', repo }, {
          note: t('notes.repoAdded'),
        });
        if (result) setValue('');
      };
      return h('div', { className: 'ops-platform-add' },
        h('form', { className: 'ops-form', onSubmit, noValidate: true },
          h(Field, { label: t('platforms.githubAddLabel'), className: 'ops-field-grow' },
            h('input', {
              className: 'ops-input',
              type: 'text',
              value,
              placeholder: t('platforms.githubAddPlaceholder'),
              onChange: (event) => setValue(event.target.value),
              disabled: busy,
              autoComplete: 'off',
              spellCheck: false,
            })),
          h('button', {
            type: 'submit',
            className: 'ops-btn ops-btn-primary',
            disabled: busy,
          }, busy ? t('common.working') : t('platforms.githubAddSubmit'))),
        h('p', { className: 'ops-form-hint' }, t('platforms.githubAddHint')),
        h(InlineError, null, formError));
    }

    function GithubRepoCard(props) {
      const { t, locale } = useI18n();
      const repo = props.repo;
      const id = String(repo.id);
      const info = asObject(repo.repoInfo);
      const runs = asArray(repo.runs);
      const openPRs = asObject(repo.openPRs);
      const prItems = asArray(openPRs.items);
      const [expanded, setExpanded] = useState(false);
      const busyRemove = props.ops.isBusy('github.repo.remove:' + id);
      const displayName = info.nameWithOwner || repo.repo || id;
      const visibleRuns = expanded ? runs : runs.slice(0, 3);
      const remove = () => props.ops.runAction('github.repo.remove:' + id, { type: 'github.repo.remove', id }, {
        note: t('notes.repoRemoved'),
      });
      return h('article', { className: 'ops-card ops-item-card ops-repo-card' },
        h('div', { className: 'ops-item-head' },
          h('div', { className: 'ops-item-title-wrap' },
            h('div', { className: 'ops-item-title-row' },
              h('strong', { className: 'ops-item-title' }, String(displayName)),
              repo.state === 'error' ? h(Pill, { tone: 'error' }, t('status.error')) : null,
              repo.state === 'loading' ? h(Pill, { tone: 'brand' }, t('status.loading')) : null,
              info.visibility ? h(Pill, { tone: 'idle' }, String(info.visibility)) : null,
              info.defaultBranch ? h('span', { className: 'ops-chip ops-mono' }, String(info.defaultBranch)) : null),
            h('div', { className: 'ops-item-sub' },
              h(ExtLink, {
                href: info.url || (String(repo.repo).indexOf('/') !== -1 ? 'https://github.com/' + String(repo.repo) : ''),
                className: 'ops-link ops-mono ops-url',
                title: info.url || repo.repo,
              }, String(repo.repo || displayName)),
              h('span', { className: 'ops-dot-sep', 'aria-hidden': 'true' }),
              h('span', { className: 'ops-muted ops-small' }, t('platforms.openPRsCount', { n: isFiniteNumber(openPRs.count) ? openPRs.count : prItems.length })),
              h('span', { className: 'ops-dot-sep', 'aria-hidden': 'true' }),
              h('span', {
                className: 'ops-muted ops-small',
                title: formatAbsolute(locale, repo.fetchedAt),
              }, t('platforms.lastFetched') + ' ' + formatRelative(t, repo.fetchedAt, props.now)))),
          h('div', { className: 'ops-item-actions' },
            h('button', {
              type: 'button',
              className: 'ops-btn',
              'aria-expanded': expanded ? 'true' : 'false',
              onClick: () => setExpanded((value) => !value),
            }, expanded ? t('common.collapse') : t('common.details')),
            h(ConfirmButton, {
              label: t('common.remove'),
              confirmLabel: t('platforms.removeRepoConfirm'),
              onConfirm: remove,
              busy: busyRemove,
            }))),
        repo.state === 'error' && repo.error
          ? h('p', { className: 'ops-inline-error' }, errorMessageText(repo.error))
          : null,
        h('div', { className: 'ops-subsection' },
          h('h4', { className: 'ops-subtitle' }, t('platforms.latestRuns')),
          runs.length === 0
            ? h('p', { className: 'ops-muted' }, t('platforms.runsEmpty'))
            : h('ul', { className: 'ops-run-list' },
              visibleRuns.map((run, index) => h('li', { key: run && run.id !== undefined ? String(run.id) : index, className: 'ops-run' },
                h(RunStatePill, { value: (run && (run.conclusion || run.status)) || 'unknown' }),
                h('div', { className: 'ops-run-main' },
                  h(ExtLink, {
                    href: run && run.url,
                    className: 'ops-link ops-run-title',
                    title: run && run.title,
                  }, (run && (run.title || run.workflow)) || t('common.unknown')),
                  h('span', {
                    className: 'ops-muted ops-small',
                    title: run ? formatAbsolute(locale, toTimestamp(run.createdAt)) : '',
                  }, [
                      run && run.workflow ? String(run.workflow) : '',
                      run && run.branch ? String(run.branch) : '',
                      run ? formatRelative(t, toTimestamp(run.createdAt), props.now) : '',
                    ].filter(Boolean).join(' · ')))))),
        expanded
          ? h('div', { className: 'ops-subsection' },
            h('div', { className: 'ops-subhead' },
              h('h4', { className: 'ops-subtitle' }, t('platforms.openPRs')),
              h('span', { className: 'ops-muted ops-small' },
                t('platforms.openPRsCount', { n: isFiniteNumber(openPRs.count) ? openPRs.count : prItems.length }))),
            prItems.length === 0
              ? h('p', { className: 'ops-muted' }, t('platforms.openPRsEmpty'))
              : h('ul', { className: 'ops-pr-list' },
                prItems.map((pr, index) => h('li', { key: pr && pr.number !== undefined ? String(pr.number) : index },
                  h(ExtLink, { href: pr && pr.url, className: 'ops-link' },
                    '#' + String((pr && pr.number) || index + 1) + ' ' + String((pr && pr.title) || '')),
                  h('span', {
                    className: 'ops-muted ops-small',
                    title: pr ? formatAbsolute(locale, toTimestamp(pr.updatedAt)) : '',
                  }, pr ? formatRelative(t, toTimestamp(pr.updatedAt), props.now) : '')))),
            h('p', { className: 'ops-muted ops-small' },
              t('platforms.lastFetched') + ' ' + formatAbsolute(locale, repo.fetchedAt)))
          : null));
    }

    function GithubCard(props) {
      const { t, locale } = useI18n();
      const github = asObject(props.snapshot && props.snapshot.github);
      const state = github.state || 'idle';
      const account = asObject(github.account);
      const repos = asArray(github.repos);
      const busyRefresh = props.ops.isBusy('github.refresh');
      const accountValue = account.login
        ? h(ExtLink, { href: account.url, className: 'ops-link' }, String(account.login))
        : t('common.none');
      return h(Card, {
        title: t('platforms.githubTitle'),
        subtitle: t('platforms.connection'),
        className: 'ops-platform-card',
        actions: h('button', {
          type: 'button',
          className: 'ops-btn',
          disabled: busyRefresh,
          onClick: () => props.ops.runAction('github.refresh', { type: 'github.refresh' }, {
            note: t('notes.githubRefreshed'),
          }),
        }, busyRefresh ? t('platforms.refreshing') : t('platforms.refresh')),
      },
      h('div', { className: 'ops-platform-status' },
        h(PlatformStatePill, { state }),
        h('span', {
          className: 'ops-muted ops-small',
          title: formatAbsolute(locale, github.lastFetchedAt),
        }, isFiniteNumber(github.lastFetchedAt) && github.lastFetchedAt > 0
          ? t('platforms.lastFetched') + ' ' + formatRelative(t, github.lastFetchedAt, props.now)
          : '')),
      h(KeyValueList, {
        rows: [
          { key: 'account', label: t('platforms.account'), value: accountValue, mono: false },
          { key: 'version', label: t('platforms.version'), value: github.version ? String(github.version) : t('common.none') },
          { key: 'repos', label: t('platforms.githubRepos'), value: String(repos.length) },
        ],
      }),
      state === 'error' && github.error
        ? h('div', { className: 'ops-error-block' },
          h('p', { className: 'ops-inline-error' }, errorMessageText(github.error)),
          errorHintText(github.error) ? h('p', { className: 'ops-muted ops-small' }, errorHintText(github.error)) : null)
        : null,
      h(PlatformStateHint, { kind: 'github', state }),
      state === 'connected' ? h(AddRepoForm, { ops: props.ops }) : null,
      state === 'connected'
        ? (repos.length === 0
          ? h(EmptyState, { title: t('platforms.repoEmpty') },
            h('p', null, t('platforms.watchlistEmptyHint')))
          : h('div', { className: 'ops-list ops-platform-list' },
            repos.map((repo) => h(GithubRepoCard, {
              key: repo.id,
              repo,
              ops: props.ops,
              now: props.now,
              locale,
            }))))
        : null);
    }

    function normalizeProjectInput(value) {
      const text = String(value || '').trim();
      if (!text) return '';
      if (/\s/.test(text) || text.indexOf('/') !== -1 || text.indexOf('\\') !== -1) return '';
      return text;
    }

    function AddProjectForm(props) {
      const { t } = useI18n();
      const [value, setValue] = useState('');
      const [formError, setFormError] = useState('');
      const busy = props.ops.isBusy('cloudflare.project.add');
      const suggestions = asArray(props.suggestions);
      const listId = 'ops-cf-project-options';
      const onSubmit = async (event) => {
        event.preventDefault();
        if (busy) return;
        const project = normalizeProjectInput(value);
        if (!project) {
          setFormError(t('platforms.cloudflareAddInvalid'));
          return;
        }
        setFormError('');
        const result = await props.ops.runAction('cloudflare.project.add', {
          type: 'cloudflare.project.add',
          project,
        }, { note: t('notes.projectAdded') });
        if (result) setValue('');
      };
      return h('div', { className: 'ops-platform-add' },
        h('form', { className: 'ops-form', onSubmit, noValidate: true },
          h(Field, { label: t('platforms.cloudflareAddLabel'), className: 'ops-field-grow' },
            h('input', {
              className: 'ops-input',
              type: 'text',
              value,
              list: suggestions.length > 0 ? listId : undefined,
              placeholder: t('platforms.cloudflareAddPlaceholder'),
              onChange: (event) => setValue(event.target.value),
              disabled: busy,
              autoComplete: 'off',
              spellCheck: false,
            })),
          h('button', {
            type: 'submit',
            className: 'ops-btn ops-btn-primary',
            disabled: busy,
          }, busy ? t('common.working') : t('platforms.cloudflareAddSubmit'))),
        suggestions.length > 0
          ? h('datalist', { id: listId },
            suggestions.map((suggestion) => h('option', { key: suggestion, value: suggestion })))
          : null,
        h('p', { className: 'ops-form-hint' }, t('platforms.cloudflareAddHint')),
        h(InlineError, null, formError));
    }

    function CloudflareProjectCard(props) {
      const { t, locale } = useI18n();
      const project = props.project;
      const id = String(project.id);
      const deployments = asArray(project.deployments);
      const domains = asArray(project.domains);
      const busyRemove = props.ops.isBusy('cloudflare.project.remove:' + id);
      const [expanded, setExpanded] = useState(false);
      const visibleDeployments = expanded ? deployments : deployments.slice(0, 4);
      const remove = () => props.ops.runAction('cloudflare.project.remove:' + id, {
        type: 'cloudflare.project.remove',
        id,
      }, { note: t('notes.projectRemoved') });
      return h('article', { className: 'ops-card ops-item-card ops-project-card' },
        h('div', { className: 'ops-item-head' },
          h('div', { className: 'ops-item-title-wrap' },
            h('div', { className: 'ops-item-title-row' },
              h('strong', { className: 'ops-item-title' }, project.project || id),
              project.state === 'error' ? h(Pill, { tone: 'error' }, t('status.error')) : null,
              project.state === 'loading' ? h(Pill, { tone: 'brand' }, t('status.loading')) : null,
              project.gitProvider ? h(Pill, { tone: 'brand' }, t('platforms.gitProvider')) : null),
            h('div', { className: 'ops-item-sub' },
              domains.length > 0
                ? h('span', { className: 'ops-domain-list' },
                  domains.map((domain, index) => h(ExtLink, {
                    key: index,
                    href: 'https://' + String(domain),
                    className: 'ops-link ops-mono ops-small',
                  }, String(domain))))
                : h('span', { className: 'ops-muted ops-small' }, t('common.none')))),
          h('div', { className: 'ops-item-actions' },
            project.dashboardUrl
              ? h(ExtLink, {
                href: project.dashboardUrl,
                className: 'ops-btn',
                title: t('platforms.dashboard'),
              }, t('platforms.dashboard'))
              : null,
            h('button', {
              type: 'button',
              className: 'ops-btn',
              'aria-expanded': expanded ? 'true' : 'false',
              onClick: () => setExpanded((value) => !value),
            }, expanded ? t('common.collapse') : t('common.details')),
            h(ConfirmButton, {
              label: t('common.remove'),
              confirmLabel: t('platforms.removeProjectConfirm'),
              onConfirm: remove,
              busy: busyRemove,
            }))),
        project.state === 'error' && project.error
          ? h('p', { className: 'ops-inline-error' }, errorMessageText(project.error))
          : null,
        h('div', { className: 'ops-subsection' },
          h('div', { className: 'ops-subhead' },
            h('h4', { className: 'ops-subtitle' }, t('platforms.deployments')),
            h('span', {
              className: 'ops-muted ops-small',
              title: formatAbsolute(locale, project.fetchedAt),
            }, t('platforms.lastFetched') + ' ' + formatRelative(t, project.fetchedAt, props.now))),
          deployments.length === 0
            ? h('p', { className: 'ops-muted' }, t('platforms.deploymentsEmpty'))
            : h('div', { className: 'ops-table-wrap' },
              h('table', { className: 'ops-table' },
                h('thead', null, h('tr', null,
                  h('th', null, t('platforms.environment')),
                  h('th', null, t('platforms.branch')),
                  h('th', null, t('platforms.source')),
                  h('th', null, t('platforms.deploymentUrl')),
                  h('th', null, t('platforms.buildLink')),
                  h('th', null, t('common.time')))),
                h('tbody', null, visibleDeployments.map((deployment, index) => h('tr', {
                  key: deployment && deployment.id !== undefined ? String(deployment.id) : index,
                },
                h('td', null, h(Pill, { tone: deployment && deployment.environment && /prod/i.test(String(deployment.environment)) ? 'success' : 'idle' },
                  deployment && deployment.environment ? String(deployment.environment) : '—')),
                h('td', { className: 'ops-mono' }, deployment && deployment.branch ? String(deployment.branch) : '—'),
                h('td', { className: 'ops-mono' }, deployment && deployment.source ? String(deployment.source) : '—'),
                h('td', { className: 'ops-cell-url' },
                  deployment && deployment.url
                    ? h(ExtLink, { href: deployment.url, className: 'ops-link', title: String(deployment.url) }, String(deployment.url))
                    : '—'),
                h('td', null, deployment && deployment.buildUrl
                  ? h(ExtLink, { href: deployment.buildUrl, className: 'ops-link' }, t('platforms.buildLink'))
                  : '—'),
                h('td', { className: 'ops-muted' }, deployment && deployment.statusText ? String(deployment.statusText) : '—')))))),
        expanded
          ? h('p', { className: 'ops-muted ops-small' },
            t('platforms.lastFetched') + ' ' + formatAbsolute(locale, project.fetchedAt))
          : null));
    }

    function CloudflareCard(props) {
      const { t, locale } = useI18n();
      const cloudflare = asObject(props.snapshot && props.snapshot.cloudflare);
      const state = cloudflare.state || 'idle';
      const account = asObject(cloudflare.account);
      const accounts = asArray(cloudflare.accounts);
      const projects = asArray(cloudflare.projects);
      const catalog = asArray(cloudflare.catalog);
      const busyRefresh = props.ops.isBusy('cloudflare.refresh');
      const suggestions = Array.from(new Set([
        ...catalog.map((item) => item && item.project),
        ...projects.map((project) => project && project.project),
      ].filter((value) => typeof value === 'string' && value)));
      const watchedNames = new Set(projects.map((project) => project && project.project).filter(Boolean));
      const addableCatalog = catalog.filter((item) => item && typeof item.project === 'string' && !watchedNames.has(item.project));
      const accountValue = account.name || account.email || account.id
        ? String(account.name || account.email || account.id)
        : t('common.none');
      const accountId = account.id ? String(account.id) : '';
      const tools = asObject(props.snapshot && props.snapshot.tools);
      const wranglerVersion = asObject(tools.wrangler).version || '';
      const cloudflareVersion = cloudflare.version ? String(cloudflare.version) : String(wranglerVersion);
      return h(Card, {
        title: t('platforms.cloudflareTitle'),
        subtitle: t('platforms.connection'),
        className: 'ops-platform-card',
        actions: h('button', {
          type: 'button',
          className: 'ops-btn',
          disabled: busyRefresh,
          onClick: () => props.ops.runAction('cloudflare.refresh', { type: 'cloudflare.refresh' }, {
            note: t('notes.cloudflareRefreshed'),
          }),
        }, busyRefresh ? t('platforms.refreshing') : t('platforms.refresh')),
      },
      h('div', { className: 'ops-platform-status' },
        h(PlatformStatePill, { state }),
        h('span', {
          className: 'ops-muted ops-small',
          title: formatAbsolute(locale, cloudflare.lastFetchedAt),
        }, isFiniteNumber(cloudflare.lastFetchedAt) && cloudflare.lastFetchedAt > 0
          ? t('platforms.lastFetched') + ' ' + formatRelative(t, cloudflare.lastFetchedAt, props.now)
          : '')),
      h(KeyValueList, {
        rows: [
          { key: 'account', label: t('platforms.account'), value: accountValue, mono: false },
          {
            key: 'email',
            label: t('platforms.email'),
            value: account.email ? String(account.email) : t('common.none'),
            mono: false,
          },
          { key: 'accountId', label: t('platforms.accountId'), value: accountId || t('common.none'), title: accountId },
          {
            key: 'permissions',
            label: t('platforms.permissions'),
            value: isFiniteNumber(cloudflare.permissionsCount)
              ? t('platforms.permissionsCount', { n: cloudflare.permissionsCount })
              : t('common.none'),
          },
          { key: 'version', label: t('platforms.version'), value: cloudflareVersion || t('common.none') },
          {
            key: 'accounts',
            label: t('platforms.accounts'),
            value: accounts.length > 0
              ? t('platforms.accountCount', { n: accounts.length })
              : t('common.none'),
          },
        ],
      }),
      accounts.length > 0
        ? h('div', { className: 'ops-chip-row' },
          accounts.map((item, index) => h('span', { key: item && item.id !== undefined ? String(item.id) : index, className: 'ops-chip' },
            String((item && (item.name || item.id)) || '—'))))
        : null,
      state === 'error' && cloudflare.error
        ? h('div', { className: 'ops-error-block' },
          h('p', { className: 'ops-inline-error' }, errorMessageText(cloudflare.error)),
          errorHintText(cloudflare.error) ? h('p', { className: 'ops-muted ops-small' }, errorHintText(cloudflare.error)) : null)
        : null,
      h(PlatformStateHint, { kind: 'cloudflare', state }),
      state === 'connected' ? h(AddProjectForm, { ops: props.ops, suggestions }) : null,
      state === 'connected' && addableCatalog.length > 0
        ? h('div', { className: 'ops-catalog' },
          h('div', { className: 'ops-subhead' },
            h('h4', { className: 'ops-subtitle' }, t('platforms.discovered')),
            h('span', { className: 'ops-muted ops-small' }, t('platforms.discoveredHint'))),
          h('div', { className: 'ops-chip-row' },
            addableCatalog.map((item) => h('button', {
              key: item.project,
              type: 'button',
              className: 'ops-chip ops-chip-action',
              disabled: props.ops.isBusy('cloudflare.project.add:' + item.project),
              onClick: () => props.ops.runAction('cloudflare.project.add:' + item.project, {
                type: 'cloudflare.project.add',
                project: item.project,
              }, { note: t('notes.projectAdded') }),
            }, item.project))))
        : null,
      state === 'connected'
        ? (projects.length === 0
          ? h(EmptyState, { title: t('platforms.projectEmpty') },
            h('p', null, t('platforms.watchlistEmptyHint')))
          : h('div', { className: 'ops-list ops-platform-list' },
            projects.map((project) => h(CloudflareProjectCard, {
              key: project.id,
              project,
              ops: props.ops,
              now: props.now,
              locale,
            }))))
        : null);
    }

    function PlatformsTab(props) {
      return h('div', { className: 'ops-tab-body' },
        h(GithubCard, { snapshot: props.snapshot, ops: props.ops, now: props.now }),
        h(CloudflareCard, { snapshot: props.snapshot, ops: props.ops, now: props.now }));
    }

    // =========================================================================
    // Settings tab
    // =========================================================================

    function buildSettingsDraft(settings) {
      const source = asObject(settings);
      const interval = INTERVAL_OPTIONS.indexOf(Number(source.intervalMinutes)) !== -1
        ? Number(source.intervalMinutes)
        : 15;
      const probes = CN_PROBE_OPTIONS.indexOf(Number(source.cnProbes)) !== -1
        ? Number(source.cnProbes)
        : 2;
      const countries = asArray(source.globalCountries)
        .map((country) => String(country))
        .filter((country) => COUNTRY_OPTIONS.indexOf(country) !== -1);
      return {
        monitorEnabled: source.monitorEnabled !== false,
        intervalMinutes: interval,
        cnProbes: probes,
        globalCountries: countries.length > 0 ? countries : ['US', 'DE'],
        historyPoints: isFiniteNumber(source.historyPoints) && source.historyPoints > 0
          ? source.historyPoints
          : HISTORY_POINTS_DEFAULT,
      };
    }

    function SettingsMonitorCard(props) {
      const { t } = useI18n();
      const settings = props.settings;
      const [draft, setDraft] = useState(() => buildSettingsDraft(settings));
      const dirtyRef = useRef(false);
      const [formError, setFormError] = useState('');
      const [dirty, setDirty] = useState(false);
      const settingsKey = settings ? JSON.stringify(settings) : '';
      useEffect(() => {
        if (dirtyRef.current) return;
        setDraft(buildSettingsDraft(settings));
        setDirty(false);
      }, [settingsKey]);
      const busy = props.ops.isBusy('settings.save');
      const update = (patch) => {
        dirtyRef.current = true;
        setDirty(true);
        setFormError('');
        setDraft((previous) => ({ ...previous, ...patch }));
      };
      const toggleCountry = (country) => {
        const current = draft.globalCountries;
        if (current.indexOf(country) !== -1) {
          if (current.length <= 1) {
            setFormError(t('settings.countryRequired'));
            return;
          }
          update({ globalCountries: current.filter((item) => item !== country) });
        } else {
          update({ globalCountries: COUNTRY_OPTIONS.filter((item) => current.indexOf(item) !== -1 || item === country) });
        }
      };
      const onSubmit = async (event) => {
        event.preventDefault();
        if (busy) return;
        if (draft.globalCountries.length === 0) {
          setFormError(t('settings.countryRequired'));
          return;
        }
        setFormError('');
        const payload = {
          monitorEnabled: Boolean(draft.monitorEnabled),
          intervalMinutes: Number(draft.intervalMinutes),
          cnProbes: Number(draft.cnProbes),
          globalCountries: draft.globalCountries.slice(),
          historyPoints: Number(draft.historyPoints),
        };
        const result = await props.ops.runAction('settings.save', {
          type: 'settings.save',
          settings: payload,
        }, { note: t('notes.settingsSaved') });
        if (result) {
          dirtyRef.current = false;
          setDirty(false);
          setFormError('');
        }
      };
      return h(Card, {
        title: t('settings.monitor'),
        subtitle: t('settings.monitorHint'),
        actions: h('button', {
          type: 'submit',
          form: 'ops-settings-form',
          className: 'ops-btn ops-btn-primary',
          disabled: busy || !dirty,
        }, busy ? t('settings.saveBusy') : t('settings.save')),
      },
      h('form', { id: 'ops-settings-form', className: 'ops-settings-form', onSubmit, noValidate: true },
        h('div', { className: 'ops-setting-row' },
          h('div', { className: 'ops-setting-text' },
            h('strong', { className: 'ops-setting-title' }, t('settings.monitorEnabled'))),
          h(Switch, {
            checked: Boolean(draft.monitorEnabled),
            onChange: (next) => update({ monitorEnabled: next }),
            disabled: busy,
            label: draft.monitorEnabled ? t('common.enabled') : t('common.disabled'),
          })),
        h('div', { className: 'ops-settings-fields' },
          h(Field, { label: t('settings.interval'), className: 'ops-field' },
            h('select', {
              className: 'ops-select',
              value: String(draft.intervalMinutes),
              onChange: (event) => update({ intervalMinutes: Number(event.target.value) }),
              disabled: busy,
            }, INTERVAL_OPTIONS.map((minutes) => h('option', { key: minutes, value: String(minutes) },
              t('settings.intervalUnit', { n: minutes }))))),
          h('div', { className: 'ops-field ops-field-grow' },
            h('span', { className: 'ops-field-label' }, t('settings.cnProbes')),
            h('div', { className: 'ops-segmented', role: 'group', 'aria-label': t('settings.cnProbes') },
              CN_PROBE_OPTIONS.map((count) => h('button', {
                key: count,
                type: 'button',
                className: 'ops-segment' + (draft.cnProbes === count ? ' ops-is-active' : ''),
                'aria-pressed': draft.cnProbes === count ? 'true' : 'false',
                disabled: busy,
                onClick: () => update({ cnProbes: count }),
              }, t('settings.probeUnit', { n: count })))),
            h('span', { className: 'ops-field-hint' }, t('settings.cnProbesHint')))),
        h('div', { className: 'ops-field' },
          h('span', { className: 'ops-field-label' }, t('settings.globalCountries')),
          h('div', { className: 'ops-checkbox-grid' },
            COUNTRY_OPTIONS.map((country) => h('label', { key: country, className: 'ops-checkbox' },
              h('input', {
                type: 'checkbox',
                checked: draft.globalCountries.indexOf(country) !== -1,
                onChange: () => toggleCountry(country),
                disabled: busy,
              }),
              h('span', null, country)))),
          h('span', { className: 'ops-field-hint' }, t('settings.globalCountriesHint'))),
        h(InlineError, null, formError),
        h('p', { className: 'ops-form-hint' }, t('settings.savedHint'))));
    }

    function SettingsQuotaCard(props) {
      const { t } = useI18n();
      const quota = asObject(props.snapshot && props.snapshot.globalping);
      const remaining = quota.remaining;
      const limit = quota.limit;
      const percent = isFiniteNumber(remaining) && isFiniteNumber(limit) && limit > 0
        ? (remaining / limit) * 100
        : null;
      const hasData = isFiniteNumber(remaining) || isFiniteNumber(limit)
        || (isFiniteNumber(quota.fetchedAt) && quota.fetchedAt > 0);
      return h(Card, { title: t('settings.quotaTitle') },
        quota.error ? h('p', { className: 'ops-inline-error' }, errorMessageText(quota.error)) : null,
        hasData
          ? h('div', { className: 'ops-quota' },
            h('div', { className: 'ops-quota-value ops-mono' },
              t('settings.remainingValue', {
                remaining: numericText(remaining),
                limit: numericText(limit),
              })),
            h(Meter, {
              value: percent,
              tone: percent !== null && percent <= 10 ? 'error' : percent !== null && percent <= 30 ? 'warn' : 'success',
            }),
            h('p', { className: 'ops-muted ops-small' },
              isFiniteNumber(quota.resetIn)
                ? t('settings.resetIn', { n: Math.max(0, Math.round(quota.resetIn / 60)) })
                : t('settings.resetUnknown')),
            quota.cooldownUntil
              ? h('p', null, h(Pill, { tone: 'warn' }, t('settings.cooldown', {
                time: formatRelative(t, quota.cooldownUntil, props.now),
              })))
              : null,
            isFiniteNumber(quota.fetchedAt) && quota.fetchedAt > 0
              ? h('p', { className: 'ops-muted ops-small', title: formatAbsolute(props.locale, quota.fetchedAt) },
                t('settings.quotaFetched', { time: formatRelative(t, quota.fetchedAt, props.now) }))
              : null)
          : h('p', { className: 'ops-muted' }, t('settings.quotaUnavailable')),
        h('div', { className: 'ops-quota-binding' },
          h(Pill, { tone: 'idle' }, t('settings.quotaAnonymous')),
          h('span', { className: 'ops-muted ops-small' }, t('settings.quotaBinding'))),
        h('p', { className: 'ops-form-hint' }, t('settings.quotaHint')));
    }

    function SettingsDataDirCard(props) {
      const { t } = useI18n();
      const dataDir = asObject(props.snapshot && props.snapshot.plugin).dataDir;
      return h(Card, { title: t('settings.dataDirTitle') },
        dataDir
          ? h('div', { className: 'ops-code-row' },
            h('code', { className: 'ops-code ops-data-dir', title: String(dataDir) }, String(dataDir)),
            h(CopyButton, { value: String(dataDir), label: t('common.copy') }))
          : h('p', { className: 'ops-muted' }, t('settings.dataDirEmpty')),
        h('p', { className: 'ops-form-hint' }, t('settings.dataDirHint')));
    }

    function SettingsCacheCard(props) {
      const { t } = useI18n();
      const historyBusy = props.ops.isBusy('cache.clear:history');
      const allBusy = props.ops.isBusy('cache.clear:all');
      const clearHistory = () => props.ops.runAction('cache.clear:history', {
        type: 'cache.clear',
        what: 'history',
      }, { note: t('notes.historyCleared') });
      const clearAll = () => props.ops.runAction('cache.clear:all', {
        type: 'cache.clear',
        what: 'all',
      }, { note: t('notes.cacheCleared') });
      return h(Card, { title: t('settings.cacheTitle') },
        h('div', { className: 'ops-cache-row' },
          h('div', { className: 'ops-setting-text' },
            h('strong', { className: 'ops-setting-title' }, t('settings.clearHistory')),
            h('p', { className: 'ops-muted ops-small' }, t('settings.clearHistoryHint'))),
          h(ConfirmButton, {
            label: t('settings.clearHistory'),
            confirmLabel: t('settings.clearHistoryConfirm'),
            onConfirm: clearHistory,
            busy: historyBusy,
            disabled: allBusy,
          })),
        h('div', { className: 'ops-cache-row' },
          h('div', { className: 'ops-setting-text' },
            h('strong', { className: 'ops-setting-title' }, t('settings.clearAll')),
            h('p', { className: 'ops-muted ops-small' }, t('settings.clearAllHint'))),
          h(ConfirmButton, {
            label: t('settings.clearAll'),
            confirmLabel: t('settings.clearAllConfirm'),
            onConfirm: clearAll,
            busy: allBusy,
            disabled: historyBusy,
          })));
    }

    function SettingsToolsCard(props) {
      const { t } = useI18n();
      const tools = asObject(props.snapshot && props.snapshot.tools);
      const definitions = [
        { key: 'ssh', label: t('settings.toolSsh') },
        { key: 'gh', label: t('settings.toolGh') },
        { key: 'wrangler', label: t('settings.toolWrangler') },
      ];
      const rows = definitions.map((definition) => {
        const tool = asObject(tools[definition.key]);
        const known = typeof tool.installed === 'boolean';
        return {
          key: definition.key,
          label: definition.label,
          known,
          installed: tool.installed === true,
          path: tool.path ? String(tool.path) : '',
          version: tool.version ? String(tool.version) : '',
        };
      });
      const missing = rows.some((row) => row.known && !row.installed);
      const busy = props.ops.isBusy('connections.refresh');
      return h(Card, {
        title: t('settings.toolsTitle'),
        actions: h('button', {
          type: 'button',
          className: 'ops-btn',
          disabled: busy,
          onClick: () => props.ops.runAction('connections.refresh', { type: 'connections.refresh' }, {
            note: t('notes.connectionsRefreshed'),
          }),
        }, busy ? t('platforms.refreshing') : t('settings.refreshConnections')),
      },
      h('div', { className: 'ops-table-wrap' },
        h('table', { className: 'ops-table' },
          h('thead', null, h('tr', null,
            h('th', null, t('common.name')),
            h('th', null, t('common.status')),
            h('th', null, t('settings.toolPath')),
            h('th', null, t('settings.toolVersion')))),
          h('tbody', null, rows.map((row) => h('tr', { key: row.key },
            h('td', null, row.label),
            h('td', null, !row.known
              ? h(Pill, { tone: 'idle' }, t('settings.toolUnknown'))
              : row.installed
                ? h(Pill, { tone: 'success' }, t('settings.toolInstalled'))
                : h(Pill, { tone: 'error' }, t('settings.toolMissing'))),
            h('td', { className: 'ops-cell-url' }, row.path
              ? h('code', { className: 'ops-code' }, row.path)
              : t('common.none')),
            h('td', { className: 'ops-mono' }, row.version || t('common.none'))))))),
      h('p', { className: 'ops-form-hint' }, t('settings.toolsHint')),
      missing ? h('p', { className: 'ops-muted ops-small' }, t('settings.toolMissingHint')) : null);
    }

    function SettingsPrivacyCard() {
      const { t } = useI18n();
      return h(Card, { title: t('settings.privacyTitle') },
        h('ul', { className: 'ops-plain-list ops-privacy-list' },
          ['privacy1', 'privacy2', 'privacy3', 'privacy4', 'privacy5'].map((key) => h('li', { key },
            t('settings.' + key)))));
    }

    function SettingsTab(props) {
      const { t } = useI18n();
      const snapshot = props.snapshot || {};
      const settings = snapshot.settings && typeof snapshot.settings === 'object' ? snapshot.settings : null;
      return h('div', { className: 'ops-tab-body' },
        settings
          ? h(SettingsMonitorCard, { settings, ops: props.ops })
          : h(EmptyState, { title: t('settings.settingsUnavailable') }),
        settings
          ? h('div', { className: 'ops-settings-grid' },
            h(SettingsQuotaCard, { snapshot, now: props.now, locale: props.locale }),
            h(SettingsDataDirCard, { snapshot }),
            h(SettingsCacheCard, { ops: props.ops }),
            h(SettingsToolsCard, { snapshot, ops: props.ops }))
          : null,
        h(SettingsPrivacyCard));
    }

    // =========================================================================
    // Page header, tabs and root page
    // =========================================================================

    /** Keep a render failure from blanking the whole slot entry. */
    class PageBoundary extends React.Component {
      constructor(props) {
        super(props);
        this.state = { error: null };
      }

      static getDerivedStateFromError(error) {
        return { error };
      }

      componentDidCatch(error) {
        try {
          console.error('[dsh-ops-console] page render failed', error);
        } catch (err) {
          /* ignore */
        }
      }

      render() {
        if (!this.state.error) return this.props.children;
        const localeId = activeLocale();
        return h('div', { className: 'ops-boundary', role: 'alert' },
          h('h2', { className: 'ops-boundary-title' }, lookupMessage(localeId, 'boundary.title')),
          h('p', { className: 'ops-boundary-text' }, lookupMessage(localeId, 'boundary.text')),
          h('pre', { className: 'ops-pre' }, String((this.state.error && this.state.error.message) || this.state.error)),
          h('button', {
            type: 'button',
            className: 'ops-btn ops-btn-primary',
            onClick: () => this.setState({ error: null }),
          }, lookupMessage(localeId, 'boundary.retry')));
      }
    }

    function PageHeader(props) {
      const { t, locale } = useI18n();
      const snapshot = props.snapshot || {};
      const plugin = asObject(snapshot.plugin);
      const settings = asObject(snapshot.settings);
      const enabled = plugin.monitorEnabled !== undefined
        ? Boolean(plugin.monitorEnabled)
        : Boolean(settings.monitorEnabled);
      const running = Boolean(plugin.running) || Boolean(props.ops.pending);
      const interval = isFiniteNumber(plugin.intervalMinutes)
        ? plugin.intervalMinutes
        : isFiniteNumber(settings.intervalMinutes) ? settings.intervalMinutes : null;
      const version = plugin.version ? String(plugin.version) : '';
      const monitorTone = running ? 'brand' : enabled ? 'success' : 'warn';
      const monitorText = running ? t('header.monitorRunning') : enabled ? t('header.monitorOn') : t('header.monitorPaused');
      const lastRefreshAt = props.ops.lastRefreshAt;
      const busyAll = props.ops.isBusy('all:refresh');
      const nextRunText = isFiniteNumber(plugin.nextRunAt)
        ? t('header.nextRun', { time: formatRelative(t, plugin.nextRunAt, props.now) })
        : '';
      return h('header', { className: 'ops-header' },
        h('div', { className: 'ops-header-main' },
          h('div', { className: 'ops-title-row' },
            h('h1', { className: 'ops-title' }, t('panelTitle')),
            version ? h('span', { className: 'ops-version ops-mono' }, 'v' + version) : null),
          h('p', { className: 'ops-subtitle' }, t('panelSubtitle'))),
        h('div', { className: 'ops-header-side' },
          h('div', { className: 'ops-header-meta' },
            h('span', null,
              t('header.lastRefreshLabel') + ' ',
              h('span', { title: formatAbsolute(locale, lastRefreshAt) },
                lastRefreshAt ? formatRelative(t, lastRefreshAt, Date.now()) : t('common.neverRefreshed'))),
            interval !== null
              ? h('span', null, t('header.monitorInterval', { n: interval }))
              : null,
            nextRunText ? h('span', null, nextRunText) : null),
          h('div', { className: 'ops-header-actions' },
            h(Pill, { tone: monitorTone, title: t('settings.monitorHint') }, monitorText),
            h('button', {
              type: 'button',
              className: 'ops-btn ops-btn-primary',
              disabled: busyAll,
              onClick: () => props.ops.refreshAll(t('notes.refreshedAll')),
            }, busyAll ? t('common.refreshing') : t('header.refreshAll')))));
    }

    function Tabs(props) {
      const { t } = useI18n();
      const onKeyDown = (event) => {
        const currentIndex = TAB_IDS.indexOf(props.active);
        let nextIndex = null;
        if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % TAB_IDS.length;
        else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + TAB_IDS.length) % TAB_IDS.length;
        else if (event.key === 'Home') nextIndex = 0;
        else if (event.key === 'End') nextIndex = TAB_IDS.length - 1;
        if (nextIndex === null) return;
        event.preventDefault();
        const nextId = TAB_IDS[nextIndex];
        props.onChange(nextId);
        const element = document.getElementById('ops-tab-' + nextId);
        if (element) element.focus();
      };
      return h('div', { className: 'ops-tabs', role: 'tablist', 'aria-label': t('tabs.label') },
        TAB_IDS.map((tabId) => {
          const selected = props.active === tabId;
          return h('button', {
            key: tabId,
            id: 'ops-tab-' + tabId,
            type: 'button',
            role: 'tab',
            'aria-selected': selected ? 'true' : 'false',
            'aria-controls': selected ? 'ops-panel-' + tabId : undefined,
            tabIndex: selected ? 0 : -1,
            className: 'ops-tab' + (selected ? ' ops-is-active' : ''),
            onClick: () => props.onChange(tabId),
            onKeyDown,
          }, t('tabs.' + tabId));
        }));
    }

    function PanelPage() {
      const i18n = useI18nValue();
      const ops = useOpsData();
      const [activeTab, setActiveTab] = useState('overview');
      const snapshot = ops.snapshot;
      const now = snapshot && isFiniteNumber(snapshot.now) ? snapshot.now : Date.now();
      const locale = i18n.locale;

      useEffect(() => {
        if (!ops.note) return undefined;
        const timer = setTimeout(() => ops.clearNote(), NOTE_TIMEOUT_MS);
        return () => clearTimeout(timer);
      }, [ops.note, ops.clearNote]);

      useEffect(() => {
        if (!ops.error || ops.error.source !== 'action') return undefined;
        const timer = setTimeout(() => {
          try {
            const banner = document.querySelector('.ops-banner-error');
            if (banner && typeof banner.scrollIntoView === 'function') {
              banner.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }
          } catch (err) {
            /* scrolling is a progressive enhancement */
          }
        }, 0);
        return () => clearTimeout(timer);
      }, [ops.error]);

      let body;
      if (!snapshot) {
        body = ops.loading
          ? h(SkeletonPage, { t: i18n.t })
          : h(EmptyState, {
            title: i18n.t('banner.loadingFailedTitle'),
            action: h('button', {
              type: 'button',
              className: 'ops-btn ops-btn-primary',
              onClick: ops.refresh,
            }, i18n.t('common.retry')),
          }, h('p', null, i18n.t('banner.loadingFailedText')));
      } else {
        const panels = [
          { id: 'overview', node: h(OverviewTab, { snapshot, ops, now }) },
          { id: 'sites', node: h(SitesTab, { snapshot, ops, now, locale }) },
          { id: 'servers', node: h(ServersTab, { snapshot, ops, now, locale }) },
          { id: 'platforms', node: h(PlatformsTab, { snapshot, ops, now }) },
          { id: 'settings', node: h(SettingsTab, { snapshot, ops, now, locale }) },
        ];
        body = h(React.Fragment, null,
          h(Tabs, { active: activeTab, onChange: setActiveTab }),
          panels.map((panel) => h('div', {
            key: panel.id,
            className: 'ops-tabpanel',
            role: 'tabpanel',
            id: 'ops-panel-' + panel.id,
            'aria-labelledby': 'ops-tab-' + panel.id,
            hidden: activeTab !== panel.id,
            tabIndex: activeTab === panel.id ? 0 : -1,
          }, panel.node)));
      }

      return h(I18nContext.Provider, { value: i18n },
        h('div', { className: 'ops-root' },
          h('div', { className: 'ops-page' },
            h(PageHeader, { snapshot, ops, now }),
            h(ErrorBanner, { error: ops.error, onDismiss: ops.dismissError }),
            h(LiveNote, { note: ops.note }),
            body)));
    }

    // =========================================================================
    // Styles — only DSH theme tokens, all classes prefixed ops-
    // =========================================================================

    const CSS = `
.ops-boundary { margin: 24px; padding: 18px; border: 1px solid var(--ops-border-strong); border-radius: 12px; background: var(--ops-layer-1); display: flex; flex-direction: column; gap: 10px; align-items: flex-start; }
.ops-boundary-title { margin: 0; font-size: 15px; }
.ops-boundary-text { margin: 0; font-size: 12px; color: var(--ops-text-secondary); }
.ops-root {
  --ops-brand: var(--dsw-alias-brand-primary);
  --ops-on-brand: var(--dsw-alias-bg-base);
  --ops-success: var(--dsw-alias-state-success-primary);
  --ops-warn: var(--dsw-alias-state-warning-primary, var(--dsw-alias-state-warn-primary));
  --ops-error: var(--dsw-alias-state-error-primary);
  --ops-idle: var(--dsw-alias-state-idle-primary);
  --ops-border: var(--dsw-alias-border-l1);
  --ops-border-strong: var(--dsw-alias-border-l2);
  --ops-text: var(--dsw-alias-label-primary);
  --ops-text-secondary: var(--dsw-alias-label-secondary);
  --ops-bg: var(--dsw-alias-bg-base);
  --ops-layer-1: var(--dsw-alias-bg-layer-1);
  --ops-layer-2: var(--dsw-alias-bg-layer-2);
  --ops-overlay: var(--dsw-alias-bg-overlay);
  flex: 1 1 auto;
  width: 100%;
  min-height: 0;
  overflow-x: hidden;
  overflow-y: auto;
  color: var(--ops-text);
  font: inherit;
  font-size: 13px;
  line-height: 1.5;
  background: transparent;
}
.ops-root,
.ops-root *,
.ops-root *::before,
.ops-root *::after { box-sizing: border-box; }
.ops-page {
  display: flex;
  flex-direction: column;
  gap: 14px;
  width: 100%;
  max-width: 1180px;
  margin: 0 auto;
  padding: 18px 22px 56px;
}
.ops-mono {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  font-variant-numeric: tabular-nums;
}
.ops-small { font-size: 11.5px; }
.ops-muted { color: var(--ops-text-secondary); }
.ops-link { color: var(--ops-brand); text-decoration: none; overflow-wrap: anywhere; }
.ops-link:hover { text-decoration: underline; }
.ops-link-inert { color: var(--ops-text-secondary); }
.ops-url { max-width: min(100%, 540px); display: inline-block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; vertical-align: bottom; }
.ops-sr-only {
  position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
}
.ops-legend { border: 1px solid var(--ops-border); border-radius: 8px; padding: 7px 10px; font-size: 11.5px; color: var(--ops-text-secondary); }
.ops-legend summary { cursor: pointer; font-weight: 500; color: var(--ops-text); }
.ops-legend-list { margin: 7px 0 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
.ops-legend-list strong { color: var(--ops-text); }
.ops-legend-text { margin: 8px 0 6px; line-height: 1.55; }
.ops-key-help { margin-top: 2px; }
.ops-help-row { display: flex; flex-direction: column; gap: 2px; margin-top: 7px; }
.ops-help-command { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ops-ssh-command { display: flex; flex-direction: column; gap: 4px; margin-top: 7px; width: 100%; }
.ops-code-row { display: flex; align-items: center; gap: 6px; min-width: 0; }
.ops-code-row .ops-code { flex: 1 1 auto; min-width: 0; }
.ops-code-row .ops-btn { flex: none; }
.ops-status-reasons { margin: 0; font-size: 11.5px; line-height: 1.5; color: var(--ops-warn); }
.ops-dot-sep { width: 3px; height: 3px; border-radius: 50%; background: var(--ops-border-strong); display: inline-block; flex: none; }

/* Header */
.ops-header {
  display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between;
  gap: 14px; padding-bottom: 13px; border-bottom: 1px solid var(--ops-border);
}
.ops-header-main { min-width: 0; flex: 1 1 320px; display: flex; flex-direction: column; gap: 3px; }
.ops-title-row { display: flex; align-items: baseline; flex-wrap: wrap; gap: 8px; }
.ops-title { margin: 0; font-size: 18px; line-height: 1.3; font-weight: 600; letter-spacing: 0.01em; }
.ops-version { font-size: 11px; color: var(--ops-text-secondary); border: 1px solid var(--ops-border); border-radius: 999px; padding: 0 6px; }
.ops-subtitle { margin: 0; font-size: 12px; color: var(--ops-text-secondary); }
.ops-header-side { display: flex; flex-direction: column; align-items: flex-end; gap: 7px; min-width: 0; }
.ops-header-meta { display: flex; flex-wrap: wrap; gap: 4px 14px; justify-content: flex-end; font-size: 11.5px; color: var(--ops-text-secondary); }
.ops-header-actions { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; justify-content: flex-end; }

/* Tabs */
.ops-tabs {
  display: flex; gap: 2px; align-items: stretch; overflow-x: auto;
  border-bottom: 1px solid var(--ops-border); scrollbar-width: thin;
}
.ops-tab {
  appearance: none; border: none; background: transparent; color: var(--ops-text-secondary);
  font: inherit; font-size: 12.5px; line-height: 1; padding: 8px 11px 9px;
  border-bottom: 2px solid transparent; cursor: pointer; white-space: nowrap; border-radius: 6px 6px 0 0;
}
.ops-tab:hover { color: var(--ops-text); background: color-mix(in srgb, var(--ops-layer-2) 55%, transparent); }
.ops-tab.ops-is-active { color: var(--ops-brand); border-bottom-color: var(--ops-brand); font-weight: 500; }
.ops-tabpanel { outline: none; }
.ops-tabpanel:focus-visible { outline: 2px solid var(--ops-brand); outline-offset: 2px; border-radius: 6px; }
.ops-tab-body { display: flex; flex-direction: column; gap: 12px; }

/* Cards */
.ops-card {
  background: var(--ops-layer-1);
  border: 1px solid var(--ops-border);
  border-radius: 10px;
  padding: 12px 14px;
}
.ops-card-head { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 8px; }
.ops-card-head-main { min-width: 0; display: flex; flex-direction: column; gap: 2px; }
.ops-card-title { margin: 0; font-size: 13px; line-height: 1.4; font-weight: 600; }
.ops-card-sub { margin: 0; font-size: 11.5px; color: var(--ops-text-secondary); }
.ops-card-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.ops-card-body { display: flex; flex-direction: column; gap: 10px; margin-top: 10px; }
.ops-item-card { display: flex; flex-direction: column; gap: 10px; }
.ops-list { display: flex; flex-direction: column; gap: 10px; }
.ops-cols { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); gap: 12px; align-items: start; }
.ops-col-main, .ops-col-side { min-width: 0; }

/* Buttons and controls */
.ops-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 4px;
  min-height: 26px; padding: 3px 9px; border-radius: 8px;
  border: 1px solid var(--ops-border);
  background: var(--ops-layer-2);
  color: var(--ops-text);
  font: inherit; font-size: 12px; line-height: 1.3;
  text-decoration: none; cursor: pointer; white-space: nowrap;
}
.ops-btn:hover { border-color: var(--ops-border-strong); }
.ops-btn:disabled { opacity: 0.55; cursor: not-allowed; }
.ops-btn-primary { background: var(--ops-brand); border-color: var(--ops-brand); color: var(--ops-on-brand); }
.ops-btn-primary:hover { border-color: var(--ops-brand); }
.ops-btn-danger { color: var(--ops-error); border-color: color-mix(in srgb, var(--ops-error) 35%, var(--ops-border)); background: transparent; }
.ops-btn-danger:hover { border-color: color-mix(in srgb, var(--ops-error) 60%, var(--ops-border)); }
.ops-btn-armed { background: var(--ops-error); border-color: var(--ops-error); color: var(--ops-on-brand); }
.ops-icon-btn {
  display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px;
  padding: 0; flex: none; border: none; border-radius: 6px; background: transparent;
  color: var(--ops-text-secondary); cursor: pointer;
}
.ops-icon-btn:hover { background: var(--ops-layer-2); color: var(--ops-text); }
.ops-btn:focus-visible, .ops-tab:focus-visible, .ops-icon-btn:focus-visible,
.ops-segment:focus-visible, .ops-switch:focus-visible, .ops-link:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--ops-brand) 55%, transparent); outline-offset: 1px;
}
.ops-input, .ops-select {
  width: 100%; min-height: 28px; padding: 3px 8px;
  border: 1px solid var(--ops-border); border-radius: 8px;
  background: var(--ops-layer-2); color: var(--ops-text); font: inherit; font-size: 12.5px;
}
.ops-input::placeholder { color: var(--ops-text-secondary); opacity: 1; }
.ops-input:focus, .ops-select:focus {
  border-color: var(--ops-brand); outline: 2px solid color-mix(in srgb, var(--ops-brand) 22%, transparent); outline-offset: 0;
}
.ops-input:disabled, .ops-select:disabled { opacity: 0.6; cursor: not-allowed; }
.ops-select { cursor: pointer; }
.ops-switch {
  display: inline-flex; align-items: center; gap: 6px;
  border: none; background: transparent; padding: 0; margin: 0;
  color: var(--ops-text); font: inherit; font-size: 11.5px; cursor: pointer;
}
.ops-switch:disabled { opacity: 0.55; cursor: not-allowed; }
.ops-switch-track {
  position: relative; display: inline-block; width: 32px; height: 18px; flex: none;
  border-radius: 999px; background: color-mix(in srgb, var(--ops-text-secondary) 38%, transparent);
  transition: background 150ms ease;
}
.ops-switch-thumb {
  position: absolute; top: 2px; left: 2px; width: 14px; height: 14px; border-radius: 50%;
  background: var(--ops-bg); box-shadow: 0 1px 2px color-mix(in srgb, var(--ops-text-secondary) 30%, transparent); transition: transform 150ms ease;
}
.ops-switch[aria-checked="true"] .ops-switch-track { background: var(--ops-brand); }
.ops-switch[aria-checked="true"] .ops-switch-thumb { transform: translateX(14px); }
.ops-switch-label { white-space: nowrap; }

/* Forms */
.ops-input-with-button { display: flex; align-items: center; gap: 6px; min-width: 0; flex: 1 1 auto; }
.ops-input-with-button .ops-input { flex: 1 1 auto; min-width: 0; width: auto; }
.ops-input-with-button .ops-btn { flex: none; white-space: nowrap; }
.ops-form { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 10px; }
.ops-field { display: flex; flex-direction: column; gap: 4px; min-width: 0; flex: 0 0 auto; }
.ops-field-label { font-size: 11.5px; color: var(--ops-text-secondary); }
.ops-field-hint { font-size: 11px; color: var(--ops-text-secondary); line-height: 1.4; }
.ops-field-grow { flex: 1 1 160px; }
.ops-field-grow-2 { flex: 2 1 220px; }
.ops-field-narrow { flex: 0 1 110px; }
.ops-field-tiny { flex: 0 1 76px; }
.ops-form-hint { margin: 0; font-size: 11.5px; color: var(--ops-text-secondary); }
.ops-inline-error { margin: 0; font-size: 12px; color: var(--ops-error); overflow-wrap: anywhere; }
.ops-toolbar { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 8px; font-size: 12px; }
.ops-toolbar > .ops-muted { font-size: 12px; }

/* Pills and chips */
.ops-pill {
  display: inline-flex; align-items: center; gap: 5px; flex: none;
  padding: 1px 7px; border-radius: 999px; border: 1px solid transparent;
  font-size: 11px; line-height: 17px; white-space: nowrap;
}
.ops-pill::before { content: ""; width: 5px; height: 5px; border-radius: 50%; background: currentColor; flex: none; }
.ops-pill-success { color: var(--ops-success); background: color-mix(in srgb, var(--ops-success) 12%, transparent); border-color: color-mix(in srgb, var(--ops-success) 30%, transparent); }
.ops-pill-warn { color: var(--ops-warn); background: color-mix(in srgb, var(--ops-warn) 12%, transparent); border-color: color-mix(in srgb, var(--ops-warn) 30%, transparent); }
.ops-pill-error { color: var(--ops-error); background: color-mix(in srgb, var(--ops-error) 12%, transparent); border-color: color-mix(in srgb, var(--ops-error) 30%, transparent); }
.ops-pill-brand { color: var(--ops-brand); background: color-mix(in srgb, var(--ops-brand) 12%, transparent); border-color: color-mix(in srgb, var(--ops-brand) 30%, transparent); }
.ops-pill-idle { color: var(--ops-text-secondary); background: color-mix(in srgb, var(--ops-text-secondary) 10%, transparent); border-color: color-mix(in srgb, var(--ops-text-secondary) 25%, transparent); }
.ops-chip-action { cursor: pointer; font: inherit; }
.ops-chip-action:hover { border-color: var(--ops-brand); color: var(--ops-brand); }
.ops-catalog { display: flex; flex-direction: column; gap: 8px; }
.ops-chip {
  display: inline-flex; align-items: center; padding: 0 7px; min-height: 20px;
  border: 1px solid var(--ops-border); border-radius: 999px;
  background: var(--ops-layer-2); color: var(--ops-text-secondary);
  font-size: 11px; line-height: 18px; white-space: nowrap;
}
.ops-chip-row { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 6px; }

/* Item rows */
.ops-item-head { display: flex; flex-wrap: wrap; align-items: flex-start; justify-content: space-between; gap: 10px; }
.ops-item-title-wrap { min-width: 0; flex: 1 1 340px; display: flex; flex-direction: column; gap: 3px; }
.ops-item-title-row { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.ops-item-title { font-size: 13.5px; font-weight: 600; overflow-wrap: anywhere; }
.ops-item-sub { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; min-width: 0; font-size: 11.5px; }
.ops-item-actions { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; }
.ops-metrics {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(108px, 1fr));
  gap: 8px; margin-top: 2px; align-items: stretch;
}
.ops-metric {
  display: flex; flex-direction: column; gap: 2px; min-width: 0;
  padding: 7px 9px; border: 1px solid var(--ops-border); border-radius: 8px;
  background: var(--ops-bg);
}
.ops-metric-label { font-size: 11px; color: var(--ops-text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.ops-metric-value { font-size: 13px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ops-metric-hint { font-size: 10.5px; color: var(--ops-text-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ops-meter { height: 6px; border-radius: 999px; overflow: hidden; background: color-mix(in srgb, var(--ops-text-secondary) 20%, transparent); margin-top: 3px; }
.ops-meter-fill { display: block; height: 100%; border-radius: inherit; background: var(--ops-brand); transition: width 180ms ease; }
.ops-meter-success { background: var(--ops-success); }
.ops-meter-warn { background: var(--ops-warn); }
.ops-meter-error { background: var(--ops-error); }
.ops-meter-brand { background: var(--ops-brand); }

/* Stats */
.ops-stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.ops-stat {
  display: flex; flex-direction: column; gap: 2px; min-width: 0;
  background: var(--ops-layer-1); border: 1px solid var(--ops-border); border-radius: 10px;
  padding: 10px 12px;
}
.ops-stat-label { font-size: 11.5px; color: var(--ops-text-secondary); }
.ops-stat-value { font-size: 18px; line-height: 1.25; font-weight: 600; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; overflow-wrap: anywhere; }
.ops-stat-hint { font-size: 11px; color: var(--ops-text-secondary); overflow-wrap: anywhere; }
.ops-stat[data-tone="success"] .ops-stat-value { color: var(--ops-success); }
.ops-stat[data-tone="warn"] .ops-stat-value { color: var(--ops-warn); }
.ops-stat[data-tone="error"] .ops-stat-value { color: var(--ops-error); }
.ops-stat[data-tone="brand"] .ops-stat-value { color: var(--ops-brand); }

/* Attention list */
.ops-attention-list, .ops-reason-list, .ops-plain-list { margin: 0; padding: 0; list-style: none; }
.ops-attention-list { display: flex; flex-direction: column; gap: 10px; }
.ops-attention-item { display: flex; flex-direction: column; gap: 3px; padding-bottom: 10px; border-bottom: 1px solid var(--ops-border); }
.ops-attention-item:last-child { padding-bottom: 0; border-bottom: none; }
.ops-attention-head { display: flex; align-items: center; justify-content: space-between; gap: 8px; }
.ops-attention-name { font-size: 12.5px; font-weight: 600; overflow-wrap: anywhere; }
.ops-attention-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.ops-reason-list { display: flex; flex-direction: column; gap: 2px; font-size: 11.5px; color: var(--ops-text-secondary); padding-left: 2px; }
.ops-reason-list li { overflow-wrap: anywhere; }
.ops-reasons { display: flex; flex-direction: column; gap: 4px; }
.ops-source-note { font-size: 12px; color: var(--ops-text-secondary); }
.ops-source-list { display: flex; flex-direction: column; gap: 6px; }
.ops-source-list li { line-height: 1.55; padding-left: 12px; position: relative; }
.ops-source-list li::before { content: ""; position: absolute; left: 0; top: 8px; width: 4px; height: 4px; border-radius: 50%; background: var(--ops-border-strong); }
.ops-source-list strong { color: var(--ops-text); font-weight: 500; }

/* Details and tables */
.ops-details { display: flex; flex-direction: column; gap: 12px; border-top: 1px solid var(--ops-border); padding-top: 11px; }
.ops-details-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; align-items: start; }
.ops-detail-block { min-width: 0; display: flex; flex-direction: column; gap: 5px; }
.ops-subtitle { margin: 0; font-size: 12px; font-weight: 600; }
.ops-subhead { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 10px; }
.ops-subsection { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.ops-kv { display: grid; grid-template-columns: max-content minmax(0, 1fr); gap: 3px 10px; margin: 0; font-size: 12px; }
.ops-kv-row { display: contents; }
.ops-kv dt { color: var(--ops-text-secondary); white-space: nowrap; }
.ops-kv dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.ops-timing-block { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
.ops-table-wrap { overflow-x: auto; overflow-y: hidden; max-width: 100%; border: 1px solid var(--ops-border); border-radius: 8px; }
.ops-table { width: 100%; min-width: 440px; border-collapse: collapse; font-size: 11.5px; }
.ops-table th {
  text-align: left; font-weight: 500; color: var(--ops-text-secondary);
  padding: 6px 8px; border-bottom: 1px solid var(--ops-border); white-space: nowrap;
  background: color-mix(in srgb, var(--ops-layer-2) 55%, transparent);
}
.ops-table td { padding: 6px 8px; border-top: 1px solid var(--ops-border); vertical-align: top; }
.ops-table tbody tr:first-child td { border-top: none; }
.ops-cell-url { max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ops-failures { display: flex; flex-direction: column; gap: 3px; margin-top: 2px; }
.ops-failures-title { font-size: 11px; color: var(--ops-text-secondary); font-weight: 500; }
.ops-failures .ops-plain-list { list-style: disc; padding-left: 18px; font-size: 11.5px; color: var(--ops-text-secondary); }
.ops-failures .ops-plain-list li { overflow-wrap: anywhere; }
.ops-pre {
  margin: 0; max-height: 320px; overflow: auto; padding: 10px;
  border: 1px solid var(--ops-border); border-radius: 8px; background: var(--ops-layer-2);
  color: var(--ops-text); font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11px; line-height: 1.45; white-space: pre-wrap; overflow-wrap: anywhere;
}
.ops-error-block { display: flex; flex-direction: column; gap: 4px; padding: 8px 10px; border-radius: 8px; background: color-mix(in srgb, var(--ops-error) 8%, transparent); }
.ops-hint-block { display: flex; flex-direction: column; gap: 5px; padding: 8px 10px; border: 1px solid var(--ops-border); border-radius: 8px; background: var(--ops-layer-2); font-size: 12px; }
.ops-hint-block p { margin: 0; color: var(--ops-text-secondary); }
.ops-code {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 11.5px; background: var(--ops-layer-2); border: 1px solid var(--ops-border);
  border-radius: 6px; padding: 1px 6px; color: var(--ops-text); overflow-wrap: anywhere;
}
.ops-code-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.ops-data-dir { flex: 1 1 220px; min-width: 0; padding: 4px 7px; word-break: break-all; }

/* Sparkline */
.ops-history { display: flex; flex-direction: column; gap: 5px; }
.ops-spark { width: 100%; max-width: 300px; height: 54px; display: block; overflow: visible; }
.ops-spark-line { stroke-width: 1.6; stroke-linejoin: round; stroke-linecap: round; }
polyline.ops-spark-line.ops-spark-localMs { stroke: var(--ops-brand); }
polyline.ops-spark-line.ops-spark-cnMs { stroke: var(--ops-warn); }
polyline.ops-spark-line.ops-spark-globalMs { stroke: var(--ops-success); }
.ops-spark-legend { display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 11px; color: var(--ops-text-secondary); }
.ops-spark-legend-item { display: inline-flex; align-items: center; gap: 5px; }
.ops-spark-swatch { display: inline-block; width: 10px; height: 2px; border-radius: 2px; }
.ops-spark-swatch.ops-spark-localMs { background: var(--ops-brand); }
.ops-spark-swatch.ops-spark-cnMs { background: var(--ops-warn); }
.ops-spark-swatch.ops-spark-globalMs { background: var(--ops-success); }
.ops-spark-note { font-size: 10.5px; color: var(--ops-text-secondary); }

/* Banner, live region, empty and skeleton states */
.ops-banner {
  display: flex; align-items: flex-start; justify-content: space-between; gap: 10px;
  padding: 10px 12px; border-radius: 10px;
}
.ops-banner-error { background: color-mix(in srgb, var(--ops-error) 10%, transparent); border: 1px solid color-mix(in srgb, var(--ops-error) 35%, transparent); }
.ops-banner-body { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ops-banner-title { font-size: 12.5px; font-weight: 600; color: var(--ops-error); }
.ops-banner-message { margin: 0; font-size: 12px; overflow-wrap: anywhere; }
.ops-banner-hint { margin: 0; font-size: 11.5px; color: var(--ops-text-secondary); overflow-wrap: anywhere; }
.ops-live:empty { display: none; }
.ops-note { display: inline-block; padding: 5px 10px; border-radius: 8px; font-size: 12px; }
.ops-note-success { color: var(--ops-success); background: color-mix(in srgb, var(--ops-success) 10%, transparent); border: 1px solid color-mix(in srgb, var(--ops-success) 30%, transparent); }
.ops-note-error { color: var(--ops-error); background: color-mix(in srgb, var(--ops-error) 10%, transparent); border: 1px solid color-mix(in srgb, var(--ops-error) 30%, transparent); }
.ops-empty {
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 5px;
  padding: 18px 14px; border: 1px dashed var(--ops-border-strong); border-radius: 10px;
  text-align: center; color: var(--ops-text-secondary); font-size: 12px;
}
.ops-empty-title { font-size: 12.5px; font-weight: 600; color: var(--ops-text); }
.ops-empty-text { max-width: 620px; line-height: 1.55; }
.ops-empty-text p { margin: 0; }
.ops-empty > .ops-btn { margin-top: 4px; }
.ops-skeleton { display: flex; flex-direction: column; gap: 10px; }
.ops-skeleton-line { height: 12px; border-radius: 6px; background: var(--ops-layer-1); border: 1px solid var(--ops-border); }
.ops-skeleton-line-wide { width: 42%; }
.ops-skeleton-line-narrow { width: 26%; }
.ops-skeleton-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; }
.ops-skeleton-card { position: relative; overflow: hidden; height: 78px; border-radius: 10px; background: var(--ops-layer-1); border: 1px solid var(--ops-border); }
.ops-skeleton-block { position: relative; overflow: hidden; height: 180px; border-radius: 10px; background: var(--ops-layer-1); border: 1px solid var(--ops-border); }
.ops-skeleton-card::after, .ops-skeleton-block::after {
  content: ""; position: absolute; inset: 0; transform: translateX(-100%);
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--ops-text-secondary) 12%, transparent), transparent);
  animation: ops-shimmer 1.4s ease-in-out infinite;
}
@keyframes ops-shimmer { 100% { transform: translateX(100%); } }
@media (prefers-reduced-motion: reduce) {
  .ops-skeleton-card::after, .ops-skeleton-block::after { animation: none; }
  .ops-meter-fill, .ops-switch-track, .ops-switch-thumb { transition: none; }
}

/* Platforms */
.ops-platform-card { scroll-margin-top: 12px; }
.ops-platform-status { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.ops-platform-add { display: flex; flex-direction: column; gap: 6px; border-top: 1px solid var(--ops-border); padding-top: 10px; }
.ops-platform-list .ops-item-card { background: var(--ops-bg); }
.ops-domain-list { display: inline-flex; flex-wrap: wrap; gap: 4px 10px; }
.ops-run-list, .ops-pr-list { margin: 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 6px; }
.ops-run { display: flex; align-items: flex-start; gap: 8px; min-width: 0; }
.ops-run-main { display: flex; flex-direction: column; gap: 1px; min-width: 0; }
.ops-run-title { font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 100%; }
.ops-pr-list li { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 4px 10px; font-size: 12px; }

/* Settings */
.ops-settings-form { display: flex; flex-direction: column; gap: 12px; }
.ops-setting-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.ops-setting-text { display: flex; flex-direction: column; gap: 2px; min-width: 0; }
.ops-setting-title { font-size: 12.5px; font-weight: 600; }
.ops-setting-text p { margin: 0; }
.ops-settings-fields { display: flex; flex-wrap: wrap; gap: 12px; align-items: flex-start; }
.ops-settings-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; align-items: start; }
.ops-cache-row { display: flex; align-items: center; justify-content: space-between; gap: 12px; }
.ops-cache-row + .ops-cache-row { padding-top: 10px; border-top: 1px solid var(--ops-border); }
.ops-quota { display: flex; flex-direction: column; gap: 5px; }
.ops-quota-binding { display: flex; align-items: flex-start; gap: 7px; flex-wrap: wrap; margin-top: 3px; }
.ops-quota-value { font-size: 18px; font-weight: 600; }
.ops-quota p { margin: 0; }
.ops-segmented { display: inline-flex; border: 1px solid var(--ops-border); border-radius: 8px; overflow: hidden; background: var(--ops-layer-2); }
.ops-segment { appearance: none; border: none; background: transparent; color: var(--ops-text-secondary); font: inherit; font-size: 12px; padding: 4px 10px; cursor: pointer; }
.ops-segment + .ops-segment { border-left: 1px solid var(--ops-border); }
.ops-segment.ops-is-active { background: var(--ops-brand); color: var(--ops-on-brand); }
.ops-segment:disabled { opacity: 0.55; cursor: not-allowed; }
.ops-checkbox-grid { display: flex; flex-wrap: wrap; gap: 5px 14px; margin-top: 1px; }
.ops-checkbox { display: inline-flex; align-items: center; gap: 5px; font-size: 12px; cursor: pointer; }
.ops-checkbox input { accent-color: var(--ops-brand); margin: 0; }
.ops-privacy-list { list-style: disc; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--ops-text-secondary); }
.ops-privacy-list li { line-height: 1.55; }

/* Responsive */
@media (max-width: 900px) {
  .ops-header { flex-direction: column; align-items: stretch; }
  .ops-header-side { align-items: flex-start; }
  .ops-header-meta, .ops-header-actions { justify-content: flex-start; }
  .ops-cols, .ops-settings-grid, .ops-details-grid { grid-template-columns: minmax(0, 1fr); }
}
@media (max-width: 640px) {
  .ops-page { padding: 14px 14px 44px; }
  .ops-stats, .ops-metrics { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ops-form { flex-direction: column; align-items: stretch; }
  .ops-field, .ops-field-grow, .ops-field-grow-2, .ops-field-narrow, .ops-field-tiny { flex: 1 1 auto; }
  .ops-settings-fields { flex-direction: column; align-items: stretch; }
  .ops-setting-row, .ops-cache-row { align-items: flex-start; flex-direction: column; }
  .ops-item-actions { width: 100%; }
  .ops-url { max-width: 100%; }
  .ops-spark { max-width: 100%; }
  .ops-table { min-width: 420px; }
}
`;

    // =========================================================================
    // Plugin module: style injection, locale bridge, slot registrations
    // =========================================================================

    function apply(ctx) {
      const locale = ctx && ctx.locale ? ctx.locale : null;

      // Locale bridge for the render hooks and the lazy sidebar label.
      ctx.effect(() => {
        localeService = locale;
        return () => {
          if (localeService === locale) localeService = null;
        };
      }, 'dsh-ops-console: locale');

      // One style element, removed with the plugin lifetime.
      ctx.effect(() => {
        const style = document.createElement('style');
        style.setAttribute('data-plugin', PLUGIN_ID);
        style.textContent = CSS;
        document.head.appendChild(style);
        return () => {
          style.remove();
        };
      }, 'dsh-ops-console: styles');

      if (!ctx.slots || typeof ctx.slots.inject !== 'function') return;

      // A shell without these slots must not crash the plugin.
      try {
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist',
          id: PANEL_ID,
          order: 55,
          label: () => labelForCurrentLocale(),
        }, PanelIcon));
      } catch (err) {
        /* sidebar slot missing */
      }

      try {
        ctx.slots.inject('main', () => ctx.slots.register({
          name: 'main',
          key: PANEL_ID,
        }, () => h(PageBoundary, null, h(PanelPage))));
      } catch (err) {
        /* main slot missing */
      }
    }

    return {
      name: PLUGIN_ID,
      inject: ['slots', 'locale'],
      apply,
    };
  },
});

