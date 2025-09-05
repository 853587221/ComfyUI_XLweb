// ============ 全局配置 ============
// 在此处修改IP地址，所有使用IP的地方都会自动更新
const CONFIG = {
    SERVER_IP: window.location.host,  // 动态获取当前ComfyUI服务器地址
    DEFAULT_PROTOCOL: window.location.protocol + '//',
    // 动态工作流配置 - 自动扫描workflow目录
    WORKFLOW_BASE_PATH: './workflow'
};

// 获取当前服务器基础URL
function getServerBaseUrl() {
    return `${CONFIG.DEFAULT_PROTOCOL}${CONFIG.SERVER_IP}`;
}

// 获取ComfyUI API基础URL
function getComfyApiUrl() {
    return getServerBaseUrl();
}

// 工作流数据存储
let workflowsData = [];
let currentWorkflow = null;

// WebSocket 相关变量
let websocket = null;
let reconnectAttempts = 0;
let queueCheckInterval = null;

// 初始化应用
document.addEventListener('DOMContentLoaded', function() {
    loadWorkflows();
    setupModalHandlers();
    setupSearchFunctionality();
    setupSettings(); // setupSettings已经包含了loadSettingsToForm调用
    initWebSocket(); // 初始化 WebSocket 连接
});

// 加载工作流数据
async function loadWorkflows() {
    try {
        // 作为ComfyUI插件，直接使用文件系统扫描
        console.log('🔄 ComfyUI插件模式：直接使用文件系统扫描');
        await loadWorkflowsFromFileSystem();
    } catch (error) {
        console.error('❌ 加载工作流失败:', error);
        await loadWorkflowsFromFileSystem();
    }
}

// 初始化 WebSocket 连接
function initWebSocket() {
    // 获取服务器地址
    const serverIp = window.settingsManager ? window.settingsManager.getSetting('serverIp') : CONFIG.SERVER_IP;
    const wsProtocol = window.location.protocol === 'https:' ? 'wss://' : 'ws://';
    const wsUrl = `${wsProtocol}${serverIp}/ws?clientId=${Date.now()}`;
    
    try {
        // 关闭现有连接
        if (websocket && websocket.readyState !== WebSocket.CLOSED) {
            websocket.close();
        }
        
        // 创建新连接
        websocket = new WebSocket(wsUrl);
        
        websocket.onopen = () => {
            console.log('WebSocket 连接已建立');
            reconnectAttempts = 0;
            showQueueStatus(true);
            startQueueStatusCheck();
        };
        
        websocket.onmessage = (event) => {
            try {
                const message = JSON.parse(event.data);
                handleWebSocketMessage(message);
            } catch (error) {
                console.error('WebSocket 消息解析失败:', error);
            }
        };
        
        websocket.onclose = (event) => {
            console.log('WebSocket 连接已关闭', event.code, event.reason);
            showQueueStatus(false);
            clearQueueStatusCheck();
            
            // 智能重连
            attemptReconnect();
        };
        
        websocket.onerror = (error) => {
            console.error('WebSocket 错误:', error);
            showQueueStatus(false);
        };
        
    } catch (error) {
        console.error('WebSocket 连接失败:', error);
        showQueueStatus(false);
        attemptReconnect();
    }
}

// 处理 WebSocket 消息
function handleWebSocketMessage(message) {
    console.log('收到 WebSocket 消息:', message);
    
    if (message.type === 'status') {
        updateQueueStatus(message.data.status);
    } else if (message.type === 'progress') {
        updateProgress(message.data);
    } else if (message.type === 'executing') {
        // 更新当前执行节点信息
        const nodeId = message.data.node;
        if (nodeId) {
            document.getElementById('queue-details').textContent = `正在执行节点: ${nodeId}`;
        } else {
            document.getElementById('queue-details').textContent = '执行完成';
            // 重置进度条
            setTimeout(() => {
                updateProgressBar(0, '等待中');
            }, 3000);
        }
    }
}

// 尝试重连
function attemptReconnect() {
    if (reconnectAttempts >= 5) return; // 最多尝试5次
    
    reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, reconnectAttempts - 1), 10000); // 指数退避，最多10秒
    
    console.log(`将在 ${delay}ms 后尝试第 ${reconnectAttempts} 次重连...`);
    
    setTimeout(() => {
        initWebSocket();
    }, delay);
}

// 显示/隐藏队列状态
function showQueueStatus(show) {
    const queueStatus = document.getElementById('queue-status');
    if (queueStatus) {
        queueStatus.style.display = show ? 'block' : 'none';
    }
}

// 更新队列状态
function updateQueueStatus(status) {
    if (!status) return;
    
    const queueDetails = document.getElementById('queue-details');
    if (!queueDetails) return;
    
    const running = status.queue_running ? status.queue_running.length : 0;
    const pending = status.queue_pending ? status.queue_pending.length : 0;
    
    if (running > 0 || pending > 0) {
        queueDetails.textContent = `运行中: ${running} | 等待中: ${pending} | 总任务: ${running + pending}`;
    } else {
        queueDetails.textContent = '队列空闲';
    }
}

// 更新进度条
function updateProgress(data) {
    if (!data) return;
    
    const { value, max } = data;
    const percent = Math.round((value / max) * 100);
    updateProgressBar(percent, `${percent}% (${value}/${max})`);
}

// 更新进度条显示
function updateProgressBar(percent, text) {
    const progressFill = document.getElementById('progress-fill');
    const progressText = document.getElementById('progress-text');
    
    if (progressFill) {
        progressFill.style.width = `${percent}%`;
    }
    
    if (progressText) {
        progressText.textContent = text;
    }
}

// 开始队列状态检查
function startQueueStatusCheck() {
    clearQueueStatusCheck(); // 清除现有的检查
    
    // 每3秒检查一次队列状态
    queueCheckInterval = setInterval(async () => {
        try {
            await checkQueueStatus();
        } catch (error) {
            console.error('队列状态检查错误:', error);
        }
    }, 3000);
}

// 清除队列状态检查
function clearQueueStatusCheck() {
    if (queueCheckInterval) {
        clearInterval(queueCheckInterval);
        queueCheckInterval = null;
    }
}

// 检查队列状态
async function checkQueueStatus() {
    try {
        const baseUrl = getComfyApiUrl();
        const response = await fetch(`${baseUrl}/queue`);
        
        if (!response.ok) {
            console.warn('无法获取队列状态:', response.statusText);
            return;
        }
        
        const queueData = await response.json();
        updateQueueStatus(queueData);
        
    } catch (error) {
        console.error('获取队列状态失败:', error);
    }
}

// 设置搜索功能
function setupSearchFunctionality() {
    const searchInput = document.getElementById('search-input');
    if (searchInput) {
        searchInput.addEventListener('input', function() {
            const searchTerm = this.value.toLowerCase().trim();
            filterWorkflows(searchTerm);
        });
    }
}

// 根据搜索词筛选工作流
function filterWorkflows(searchTerm) {
    const workflowsContainer = document.getElementById('workflows-container');
    const cards = workflowsContainer.querySelectorAll('.workflow-card');
    
    if (searchTerm === '') {
        // 如果搜索词为空，显示所有卡片
        cards.forEach(card => {
            card.style.display = 'block';
        });
        return;
    }
    
    // 否则根据搜索词筛选
    cards.forEach(card => {
        const title = card.querySelector('.workflow-title').textContent.toLowerCase();
        const description = card.querySelector('.workflow-description')?.textContent.toLowerCase() || '';
        
        if (title.includes(searchTerm) || description.includes(searchTerm)) {
            card.style.display = 'block';
        } else {
            card.style.display = 'none';
        }
    });
}

// 设置功能
function setupSettings() {
    // 初始化设置管理器
    if (!window.settingsManager) {
        window.settingsManager = new SettingsManager();
    }
    
    // 初始化语言管理器
    if (!window.languageManager) {
        window.languageManager = new LanguageManager();
    }
    
    // 应用保存的主题
    const savedTheme = window.settingsManager.getSetting('defaultTheme') || 'dark';
    applyTheme(savedTheme);
    
    // 加载保存的设置到表单（在页面初始化时自动显示保存的IP）
    setTimeout(async () => {
        // 加载设置到表单
        loadSettingsToForm();
        
        // 初始化语言系统
        await initializeLanguageSystem();
    }, 100); // 等待DOM元素完全加载
}

// 初始化语言系统
async function initializeLanguageSystem() {
    try {
        // 获取保存的语言设置
        const savedLanguage = window.settingsManager.getSetting('language') || 'auto';
        let targetLanguage = savedLanguage;
        
        // 如果是自动模式，获取系统语言
        if (savedLanguage === 'auto') {
            targetLanguage = getSystemLanguage();
        }
        
        console.log(`🌍 初始化语言系统: ${savedLanguage} -> ${targetLanguage}`);
        
        // 加载并应用语言
        await window.languageManager.setLanguage(targetLanguage);
        
    } catch (error) {
        console.error('初始化语言系统失败:', error);
        // 回退到默认语言
        await window.languageManager.setLanguage('zh-CN');
    }
}

// 获取系统语言
function getSystemLanguage() {
    const systemLang = navigator.language || navigator.userLanguage || 'zh-CN';
    const supportedLanguages = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'fr', 'de', 'ar', 'ru', 'hi', 'es'];
    
    // 查找匹配的语言
    const matchedLang = supportedLanguages.find(lang => 
        systemLang.toLowerCase().startsWith(lang.toLowerCase()) ||
        systemLang.toLowerCase().includes(lang.toLowerCase())
    );
    
    return matchedLang || 'zh-CN'; // 默认中文
}

// 应用主题
function applyTheme(theme) {
    const body = document.body;
    body.classList.remove('dark-theme', 'light-theme');
    body.classList.add(theme + '-theme');
}

// 设置管理器
class SettingsManager {
    constructor() {
        this.defaultSettings = {
            serverIp: CONFIG.SERVER_IP,
            imageSizeLimit: 10,
            videoSizeLimit: 100,
            audioSizeLimit: 50,
            defaultTheme: 'dark',
            language: 'auto'
        };
        
        this.currentSettings = { ...this.defaultSettings };
        this.loadSettings();
    }
    
    loadSettings() {
        try {
            const saved = localStorage.getItem('comfyui-settings');
            if (saved) {
                this.currentSettings = { ...this.defaultSettings, ...JSON.parse(saved) };
            }
        } catch (error) {
            console.error('加载设置失败:', error);
            this.currentSettings = { ...this.defaultSettings };
        }
    }
    
    saveSettings() {
        try {
            localStorage.setItem('comfyui-settings', JSON.stringify(this.currentSettings));
            return true;
        } catch (error) {
            console.error('保存设置失败:', error);
            return false;
        }
    }
    
    getSetting(key) {
        return this.currentSettings[key];
    }
    
    setSetting(key, value) {
        this.currentSettings[key] = value;
    }
    
    resetToDefaults() {
        this.currentSettings = { ...this.defaultSettings };
    }
}

// 设置功能全局函数
function openSettings() {
    const modal = document.getElementById('settings-modal');
    if (modal) {
        // 加载当前设置到表单（确保显示最新的保存值）
        loadSettingsToForm();
        modal.classList.add('show');
        document.body.style.overflow = 'hidden';
        
        console.log('💾 打开设置，当前服务器地址:', window.settingsManager.getSetting('serverIp'));
    }
}

function closeSettings() {
    const modal = document.getElementById('settings-modal');
    if (modal) {
        modal.classList.remove('show');
        document.body.style.overflow = '';
    }
}

function saveSettings() {
    try {
        const serverIpInput = document.getElementById('server-ip').value.trim();
        const imageSizeLimit = parseInt(document.getElementById('image-size-limit').value);
        const videoSizeLimit = parseInt(document.getElementById('video-size-limit').value);
        const audioSizeLimit = parseInt(document.getElementById('audio-size-limit').value);
        const defaultTheme = document.getElementById('default-theme').value;
        const language = document.getElementById('language-select').value;
        
        if (!serverIpInput) {
            alert('请输入有效的服务器地址');
            return;
        }
        
        // 使用智能URL标准化处理
        const normalizedUrl = normalizeServerUrl(serverIpInput);
        const serverAddress = extractServerAddress(normalizedUrl);
        
        console.log('💾 保存设置:');
        console.log('  输入地址:', serverIpInput);
        console.log('  标准化URL:', normalizedUrl);
        console.log('  存储地址:', serverAddress);
        console.log('  语言设置:', language);
        
        if (isNaN(imageSizeLimit) || imageSizeLimit <= 0 || imageSizeLimit > 100) {
            alert('图像文件大小限制必须在1-100MB之间');
            return;
        }
        
        if (isNaN(videoSizeLimit) || videoSizeLimit <= 0 || videoSizeLimit > 1000) {
            alert('视频文件大小限制必须在1-1000MB之间');
            return;
        }
        
        if (isNaN(audioSizeLimit) || audioSizeLimit <= 0 || audioSizeLimit > 500) {
            alert('音频文件大小限制必须在1-500MB之间');
            return;
        }
        
        // 保存标准化后的服务器地址（仅保存ip:端口部分）
        window.settingsManager.setSetting('serverIp', serverAddress);
        window.settingsManager.setSetting('imageSizeLimit', imageSizeLimit);
        window.settingsManager.setSetting('videoSizeLimit', videoSizeLimit);
        window.settingsManager.setSetting('audioSizeLimit', audioSizeLimit);
        window.settingsManager.setSetting('defaultTheme', defaultTheme);
        window.settingsManager.setSetting('language', language);
        
        if (window.settingsManager.saveSettings()) {
            showNotification(window.languageManager.t('messages.settingsSaved') || '设置已保存', 'success');
            applyTheme(defaultTheme);
            
            // 记录新的服务器地址和语言
            console.log('🔄 主页设置已保存，新服务器地址:', serverAddress);
            console.log('🌍 语言设置已保存:', language);
            console.log('📝 设置将在进入工作流界面时生效');
            
            // 应用语言设置，但不显示提示
            applyLanguageSetting(language, false);
            
            // 如果当前在ComfyUI界面，立即更新服务器地址
            if (window.comfyInterface && typeof window.comfyInterface.updateServerUrl === 'function') {
                console.log('🔄 检测到ComfyUI界面，立即更新服务器地址');
                window.comfyInterface.updateServerUrl(serverAddress);
                showNotification(window.languageManager.t('messages.serverUpdated') || '服务器地址已立即生效', 'success');
            }
            
            setTimeout(() => {
                closeSettings();
            }, 1000);
        } else {
            showNotification(window.languageManager.t('errors.unknown') || '保存设置失败', 'error');
        }
    } catch (error) {
        console.error('保存设置时出错:', error);
        showNotification(window.languageManager.t('errors.unknown') || '保存设置时出错: ' + error.message, 'error');
    }
}

// 应用语言设置
async function applyLanguageSetting(language, showNotify = true) {
    try {
        let targetLanguage = language;
        
        // 如果是自动模式，获取系统语言
        if (language === 'auto') {
            targetLanguage = getSystemLanguage();
        }
        
        console.log(`🔄 应用语言设置: ${language} -> ${targetLanguage}`);
        
        // 加载并应用语言
        await window.languageManager.setLanguage(targetLanguage);
        
        // 只有在showNotify为true时才显示通知
        if (showNotify) {
            showNotification(window.languageManager.t('messages.languageUpdated') || '语言设置已更新', 'success');
        }
        
    } catch (error) {
        console.error('应用语言设置失败:', error);
        showNotification('语言设置失败: ' + error.message, 'error');
    }
}

function resetSettings() {
    if (confirm('确定要重置所有设置为默认值吗？')) {
        // 重置设置到默认值
        window.settingsManager.resetToDefaults();
        // 保存重置后的设置到localStorage
        window.settingsManager.saveSettings();
        // 更新表单显示
        loadSettingsToForm();
        // 应用设置（主题、语言等）
        applyTheme(window.settingsManager.getSetting('defaultTheme'));
        // 应用语言设置，但不显示提示
        applyLanguageSetting(window.settingsManager.getSetting('language'), false);
        
        console.log('🔄 设置已重置为默认值:', window.settingsManager.currentSettings);
        
        showNotification('设置已重置为默认值', 'success');
    }
}

function switchTheme(theme) {
    applyTheme(theme);
    const darkBtn = document.getElementById('dark-theme-btn');
    const lightBtn = document.getElementById('light-theme-btn');
    
    if (darkBtn && lightBtn) {
        darkBtn.classList.toggle('active', theme === 'dark');
        lightBtn.classList.toggle('active', theme === 'light');
    }
    
    const defaultThemeSelect = document.getElementById('default-theme');
    if (defaultThemeSelect) {
        defaultThemeSelect.value = theme;
    }
}

function loadSettingsToForm() {
    const settings = window.settingsManager.currentSettings;
    
    const serverIpInput = document.getElementById('server-ip');
    if (serverIpInput) {
        serverIpInput.value = settings.serverIp;
        console.log('📝 主页加载保存的服务器地址:', settings.serverIp);
    }
    
    const imageSizeLimitInput = document.getElementById('image-size-limit');
    if (imageSizeLimitInput) {
        imageSizeLimitInput.value = settings.imageSizeLimit;
    }
    
    const videoSizeLimitInput = document.getElementById('video-size-limit');
    if (videoSizeLimitInput) {
        videoSizeLimitInput.value = settings.videoSizeLimit;
    }
    
    const audioSizeLimitInput = document.getElementById('audio-size-limit');
    if (audioSizeLimitInput) {
        audioSizeLimitInput.value = settings.audioSizeLimit;
    }
    
    const defaultThemeSelect = document.getElementById('default-theme');
    if (defaultThemeSelect) {
        defaultThemeSelect.value = settings.defaultTheme;
    }
    
    // 加载语言设置
    const languageSelect = document.getElementById('language-select');
    if (languageSelect) {
        languageSelect.value = settings.language;
        console.log('🌍 主页加载保存的语言设置:', settings.language);
    }
    
    // 更新主题按钮状态
    const darkBtn = document.getElementById('dark-theme-btn');
    const lightBtn = document.getElementById('light-theme-btn');
    if (darkBtn && lightBtn) {
        darkBtn.classList.toggle('active', settings.defaultTheme === 'dark');
        lightBtn.classList.toggle('active', settings.defaultTheme === 'light');
    }
}

function showNotification(message, type = 'info') {
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: rgba(255, 255, 255, 0.1);
        backdrop-filter: blur(10px);
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 8px;
        padding: 16px 20px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
        z-index: 1001;
        max-width: 400px;
        transform: translateX(100%);
        transition: transform 0.3s ease;
        color: white;
    `;
    
    const colors = {
        success: '#10b981',
        error: '#ef4444',
        warning: '#f59e0b',
        info: '#6366f1'
    };
    
    // 翻译按钮文本
    const typeText = window.languageManager ? (
        window.languageManager.t(`messages.${type}`) || type.charAt(0).toUpperCase() + type.slice(1)
    ) : type.charAt(0).toUpperCase() + type.slice(1);
    
    notification.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px;">
            <div style="width: 4px; height: 40px; background: ${colors[type]}; border-radius: 2px;"></div>
            <div style="flex: 1;">
                <div style="font-weight: 500; margin-bottom: 4px;">${typeText}</div>
                <div style="font-size: 0.875rem; opacity: 0.8;">${message}</div>
            </div>
            <button onclick="this.parentElement.parentElement.remove()" 
                    style="background: none; border: none; color: white; cursor: pointer; padding: 4px; opacity: 0.7;">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 100);
    
    setTimeout(() => {
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, 300);
    }, 3000);
}

// 检测是否为IPv6地址的辅助函数
function isIPv6Address(address) {
    // 移除方括号（如果有）
    const cleanAddress = address.replace(/^\[|\]$/g, '');
    
    // IPv6地址模式检测
    const ipv6Pattern = /^([0-9a-fA-F]{0,4}:){1,7}[0-9a-fA-F]{0,4}$|^::([0-9a-fA-F]{0,4}:){0,6}[0-9a-fA-F]{0,4}$|^([0-9a-fA-F]{0,4}:){1,6}::$|^([0-9a-fA-F]{0,4}:){1,5}:([0-9a-fA-F]{0,4}:){1,1}[0-9a-fA-F]{0,4}$|^([0-9a-fA-F]{0,4}:){1,4}:([0-9a-fA-F]{0,4}:){1,2}[0-9a-fA-F]{0,4}$|^([0-9a-fA-F]{0,4}:){1,3}:([0-9a-fA-F]{0,4}:){1,3}[0-9a-fA-F]{0,4}$|^([0-9a-fA-F]{0,4}:){1,2}:([0-9a-fA-F]{0,4}:){1,4}[0-9a-fA-F]{0,4}$|^[0-9a-fA-F]{0,4}::([0-9a-fA-F]{0,4}:){1,5}[0-9a-fA-F]{0,4}$|^::([0-9a-fA-F]{0,4}:){0,5}[0-9a-fA-F]{0,4}$|^([0-9a-fA-F]{0,4}:){1,7}:$|^::[0-9a-fA-F]{0,4}$|^::$/;
    
    // 检测链路本地地址（包含%）
    const linkLocalPattern = /^([0-9a-fA-F]{0,4}:){1,7}[0-9a-fA-F]{0,4}%[a-zA-Z0-9]+$/;
    
    return ipv6Pattern.test(cleanAddress) || linkLocalPattern.test(cleanAddress);
}

// 检测是否为域名的辅助函数
function isDomain(address) {
    // 域名模式检测（包含字母且有点分隔）
    const domainPattern = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
    const localhostPattern = /^localhost$/i;
    
    return domainPattern.test(address) || localhostPattern.test(address);
}

// 智能URL标准化处理功能 - 增强支持IPv6和域名
function normalizeServerUrl(input) {
    if (!input || input.trim() === '') {
        return CONFIG.DEFAULT_PROTOCOL + CONFIG.SERVER_IP;
    }
    
    let serverUrl = input.trim();
    
    // 支持的格式：
    // 1. 完整URL: http://服务器ip/ 和 https://服务器ip/
    // 2. 完整URL无斜杠: http://服务器ip 和 https://服务器ip
    // 3. IP:端口: 服务器ip:端口（自动添加http://前缀）
    // 4. IPv6格式: [::1]:8188, [2001:db8::1]:8188, ::1, 2001:db8::1
    // 5. 域名格式: example.com:8188, subdomain.example.com, https://secure.example.com
    
    // 如果已经有协议前缀
    if (serverUrl.startsWith('http://') || serverUrl.startsWith('https://')) {
        // 移除末尾的斜杠，保持标准格式
        return serverUrl.replace(/\/$/, '');
    }
    
    // 处理IPv6地址
    if (serverUrl.startsWith('[') && serverUrl.includes(']:')) {
        // 标准IPv6格式 [address]:port
        return `http://${serverUrl}`;
    }
    
    // 检查是否为纯IPv6地址（无端口）
    if (isIPv6Address(serverUrl)) {
        // 纯IPv6地址，添加方括号和默认端口
        return `http://[${serverUrl}]:8188`;
    }
    
    // 检查是否为域名
    if (isDomain(serverUrl)) {
        // 纯域名，添加默认端口
        return `http://${serverUrl}:8188`;
    }
    
    // 检查是否包含端口（IPv4:port 或 domain:port）
    if (serverUrl.includes(':')) {
        // 检查是否为域名:端口格式
        const parts = serverUrl.split(':');
        if (parts.length === 2 && isDomain(parts[0])) {
            return `http://${serverUrl}`;
        }
        // IPv4:端口格式，添加 http:// 前缀
        return `http://${serverUrl}`;
    }
    
    // 纯IP地址或localhost，添加默认端口和协议
    return `http://${serverUrl}:8188`;
}

// 提取服务器地址用于显示和保存 - 增强支持IPv6
function extractServerAddress(normalizedUrl) {
    try {
        const url = new URL(normalizedUrl);
        
        // 处理IPv6地址（已经在方括号中）
        if (url.hostname.startsWith('[') && url.hostname.endsWith(']')) {
            // IPv6地址，保持方括号格式
            const port = url.port ? `:${url.port}` : '';
            return `${url.hostname}${port}`;
        }
        
        // 普通域名或IPv4地址
        const port = url.port ? `:${url.port}` : '';
        return `${url.hostname}${port}`;
    } catch (error) {
        console.warn('URL解析失败，使用备用方法:', error);
        
        // 如果URL解析失败，使用备用方法
        let cleanUrl = normalizedUrl.replace(/^https?:\/\//, '');
        
        // 处理IPv6地址格式
        if (cleanUrl.startsWith('[')) {
            // IPv6格式 [address]:port 或 [address]
            return cleanUrl;
        }
        
        return cleanUrl;
    }
}

// 测试服务器连接
function testServerConnection() {
    const serverIp = document.getElementById('server-ip').value.trim();
    if (!serverIp) {
        showNotification('请先输入服务器地址', 'warning');
        return;
    }
    
    // 使用智能URL标准化
    const normalizedUrl = normalizeServerUrl(serverIp);
    console.log('🔍 正在测试服务器连接:', normalizedUrl);
    console.log('📝 输入地址:', serverIp, '-> 标准化后:', normalizedUrl);
    
    showNotification('正在测试连接...', 'info');
    
    // 测试连接
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10秒超时
    
    fetch(`${normalizedUrl}/system_stats`, {
        method: 'GET',
        signal: controller.signal
    })
    .then(response => {
        clearTimeout(timeoutId);
        if (response.ok) {
            showNotification(`连接成功！服务器 ${extractServerAddress(normalizedUrl)} 响应正常`, 'success');
            console.log('✅ 服务器连接测试成功');
        } else {
            showNotification(`连接失败：服务器响应错误 (${response.status})`, 'error');
            console.error('❌ 服务器响应错误:', response.status, response.statusText);
        }
    })
    .catch(error => {
        clearTimeout(timeoutId);
        if (error.name === 'AbortError') {
            showNotification('连接超时：请检查服务器地址是否正确', 'error');
            console.error('❌ 连接超时');
        } else {
            showNotification(`连接失败：${error.message}`, 'error');
            console.error('❌ 服务器连接失败:', error);
        }
    });
}

// 从文件系统加载工作流
async function loadWorkflowsFromFileSystem() {
    try {
        workflowsData = [];
        
        // 支持的图像格式
        const imageExtensions = ['.png', '.jpeg', '.jpg', '.webp', '.gif', '.svg'];
        
        // 获取所有工作流文件夹
        const workflowFolders = await getAllWorkflowFolders();
        
        // 扫描每个文件夹
        for (const folder of workflowFolders) {
            try {
                const folderData = await scanWorkflowFolder(folder, imageExtensions);
                if (folderData) {
                    workflowsData.push(folderData);
                }
            } catch (error) {
                console.warn(`扫描文件夹失败: ${folder}`, error);
            }
        }
        
        renderWorkflows();
    } catch (error) {
        console.error('加载工作流失败:', error);
    }
}

// 扫描工作流文件夹
async function scanWorkflowFolder(folderName, imageExtensions) {
    const basePath = `workflow/${folderName}`;
    
    try {
        // 直接尝试获取文件夹中的所有文件（已支持预定义列表）
        const files = await getFolderFiles(basePath);
        
        if (!files || files.length === 0) {
            console.warn(`文件夹 ${folderName} 为空或无法访问`);
            return null;
        }
        
        // 查找第一个图像文件
        let imageFile = null;
        for (const file of files) {
            const lowerFile = file.toLowerCase();
            for (const ext of imageExtensions) {
                if (lowerFile.endsWith(ext)) {
                    imageFile = `${basePath}/${file}`;
                    break;
                }
            }
            if (imageFile) break;
        }
        
        // 如果没有找到图像文件，使用默认图像
        if (!imageFile) {
            console.warn(`在 ${folderName} 中未找到图像文件，使用默认图像`);
            // 使用base64编码的默认图像
            imageFile = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgdmlld0JveD0iMCAwIDIwMCAyMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik0xMDAgMTMzQzExNy4zMiAxMzMgMTMxLjUgMTE4LjgyIDEzMS41IDEwMS41QzEzMS41IDg0LjE4MDEgMTE3LjMyIDcwIDEwMCA3MEM4Mi42ODAxIDcwIDY4LjUgODQuMTgwMSA2OC41IDEwMS41QzY4LjUgMTE4LjgyIDgyLjY4MDEgMTMzIDEwMCAxMzNaIiBmaWxsPSIjOUE5QUE5Ii8+Cjwvc3ZnPgo=';
        }
        
        // 查找第一个txt文件
        let txtFile = null;
        for (const file of files) {
            if (file.toLowerCase().endsWith('.txt')) {
                txtFile = `${basePath}/${file}`;
                break;
            }
        }
        
        // 查找第一个json文件
        let jsonFile = null;
        for (const file of files) {
            if (file.toLowerCase().endsWith('.json')) {
                jsonFile = `${basePath}/${file}`;
                break;
            }
        }
        
        if (!jsonFile) {
            console.warn(`在 ${folderName} 中未找到json文件`);
            return null;
        }
        
        // 读取描述内容
        let description = "暂无描述";
        if (txtFile) {
            try {
                // 添加时间戳参数防止缓存
                const cacheBuster = '?' + new Date().getTime();
                const txtResponse = await fetch(txtFile + cacheBuster);
                if (txtResponse.ok) {
                    description = await txtResponse.text();
                }
            } catch (error) {
                console.warn(`读取描述文件失败: ${txtFile}`);
            }
        }
        
        return {
            name: folderName,
            description: description.trim(),
            image: imageFile,
            json: jsonFile,
            folder: folderName
        };
        
    } catch (error) {
        console.warn(`处理文件夹 ${folderName} 时出错:`, error);
        return null;
    }
}

// 获取所有工作流文件夹
async function getAllWorkflowFolders() {
    try {
        // 作为ComfyUI插件，使用插件路径访问workflow目录
        const response = await fetch('/xlweb/workflow/');
        if (response.ok) {
            const html = await response.text();
            const folders = parseFolderNamesFromHtml(html);
            if (folders && folders.length > 0) {
                console.log('✅ 动态获取到工作流文件夹:', folders);
                return folders;
            }
        }
        
        // 如果目录浏览失败，尝试检测已知的文件夹
        console.warn('⚠️ 无法动态获取workflow目录列表，尝试检测已知文件夹');
        const knownFolders = ['默认文生图', '默认图生图', 'video_wan2_2_14B_i2v'];
        const existingFolders = [];
        
        for (const folder of knownFolders) {
            try {
                const testResponse = await fetch(`/xlweb/workflow/${folder}/`);
                if (testResponse.ok) {
                    existingFolders.push(folder);
                    console.log(`✅ 检测到文件夹: ${folder}`);
                }
            } catch (e) {
                console.log(`❌ 文件夹不存在: ${folder}`);
            }
        }
        
        return existingFolders;
    } catch (error) {
        console.error('❌ 获取工作流文件夹失败:', error);
        return [];
    }
}

// 从HTML响应中解析文件夹名称
function parseFolderNamesFromHtml(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const folderLinks = doc.querySelectorAll('a[href$="/"]');
    const folderNames = [];
    
    folderLinks.forEach(link => {
        // 确保文件夹名称不包含斜杠
        const folderName = link.textContent.trim().replace(/\/$/, '');
        // 排除父目录链接(..)和当前目录链接(.)
        if (folderName !== '..' && folderName !== '.') {
            folderNames.push(folderName);
        }
    });
    
    return folderNames;
}

// 获取文件夹中的文件列表
async function getFolderFiles(folderPath) {
    try {
        // 作为ComfyUI插件，使用插件路径访问文件夹
        const response = await fetch(`/xlweb/${folderPath}/`);
        if (response.ok) {
            const html = await response.text();
            const files = parseFileNamesFromHtml(html);
            if (files && files.length > 0) {
                console.log(`✅ 动态获取到${folderPath}文件列表:`, files);
                return files;
            }
        }
        
        // 如果目录浏览失败，尝试检测常见文件
        console.warn(`⚠️ 无法动态获取${folderPath}目录下的文件列表，尝试检测常见文件`);
        const commonFiles = ['default.json', 'image2image.json', 'i2v_wan2.2.json', 'default.txt', '1.txt', 'default.webp', 'e82f6ec4-47e5-45dd-bbb9-669934d5f5a0.webp', 'a5cd4f5a-dd87-466d-8a08-8bfa9080a9d5.webp'];
        const existingFiles = [];
        
        for (const file of commonFiles) {
            try {
                const testResponse = await fetch(`/xlweb/${folderPath}/${file}`);
                if (testResponse.ok) {
                    existingFiles.push(file);
                    console.log(`✅ 检测到文件: ${folderPath}/${file}`);
                }
            } catch (e) {
                // 文件不存在，继续检测下一个
            }
        }
        
        return existingFiles;
    } catch (error) {
        console.error(`❌ 获取${folderPath}目录文件失败:`, error);
        return [];
    }
}

// 从HTML响应中解析文件名称
function parseFileNamesFromHtml(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    const fileLinks = doc.querySelectorAll('a:not([href$="/"])');
    const fileNames = [];
    
    fileLinks.forEach(link => {
        const fileName = link.textContent.trim();
        fileNames.push(fileName);
    });
    
    return fileNames;
}

// 渲染工作流卡片
function renderWorkflows() {
    const container = document.getElementById('workflows-container');
    
    if (workflowsData.length === 0) {
        showEmptyState();
        return;
    }
    
    container.style.display = 'grid';
    document.getElementById('empty-state').style.display = 'none';
    
    container.innerHTML = '';
    
    workflowsData.forEach((workflow, index) => {
        const card = createWorkflowCard(workflow, index);
        container.appendChild(card);
    });
}

// 创建工作流卡片
function createWorkflowCard(workflow, index) {
    const card = document.createElement('div');
    card.className = 'workflow-card';
    card.style.animationDelay = `${index * 0.1}s`;
    
    card.innerHTML = `
        <div class="workflow-image-container">
            <img class="workflow-image" src="${workflow.image}" alt="${workflow.name}" loading="lazy">
        </div>
        <div class="workflow-info">
            <h3 class="workflow-title">${workflow.name}</h3>
            <p class="workflow-description">${workflow.description}</p>
            <div class="workflow-meta">
                
            </div>
        </div>
    `;
    
    card.addEventListener('click', () => openWorkflowModal(workflow));
    
    return card;
}

// 设置模态框处理器
function setupModalHandlers() {
    const modal = document.getElementById('workflow-modal');
    const closeBtn = document.querySelector('.close');
    
    closeBtn.addEventListener('click', closeModal);
    
    window.addEventListener('click', (event) => {
        if (event.target === modal) {
            closeModal();
        }
    });
    
    // ESC键关闭模态框
    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') {
            closeModal();
        }
    });
}

// 打开工作流模态框
function openWorkflowModal(workflow) {
    currentWorkflow = workflow;
    
    const modal = document.getElementById('workflow-modal');
    const modalImage = document.getElementById('modal-image');
    const modalTitle = document.getElementById('modal-title');
    const modalDescription = document.getElementById('modal-description');
    
    modalImage.src = workflow.image;
    modalImage.alt = workflow.name;
    modalTitle.textContent = workflow.name;
    modalDescription.textContent = workflow.description;
    
    modal.style.display = 'block';
    document.body.style.overflow = 'hidden';
    
    // 添加动画效果
    setTimeout(() => {
        modal.querySelector('.modal-content').style.transform = 'scale(1)';
    }, 10);
}

// 关闭模态框
function closeModal() {
    const modal = document.getElementById('workflow-modal');
    modal.style.display = 'none';
    document.body.style.overflow = 'auto';
    currentWorkflow = null;
}

// 加载工作流
function loadWorkflow() {
    if (currentWorkflow) {
        // 已移除工作流编辑器功能
        alert('工作流编辑器功能已移除。您可以使用"下载工作流JSON"按钮获取工作流文件。');
    }
}

// 应用工作流
function applyWorkflow() {
    if (currentWorkflow) {
        try {
            // 构建URL参数
            const urlParams = new URLSearchParams();
            urlParams.append('workflow', currentWorkflow.json);
            
            // 在当前页面打开 ComfyUI 界面
            window.location.href = `comfyui-interface.html?${urlParams.toString()}`;
        } catch (error) {
            console.error('打开ComfyUI界面失败:', error);
            alert('打开ComfyUI界面失败: ' + error.message);
        }
    }
}

// 下载工作流JSON
function downloadWorkflow() {
    if (currentWorkflow) {
        const link = document.createElement('a');
        link.href = currentWorkflow.json;
        link.download = `${currentWorkflow.folder}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    }
}

// 显示空状态
function showEmptyState() {
    const container = document.getElementById('workflows-container');
    const emptyState = document.getElementById('empty-state');
    
    container.style.display = 'none';
    emptyState.style.display = 'block';
}

// 添加页面加载动画
window.addEventListener('load', () => {
    document.body.classList.add('loaded');
});

// 多语言管理器类 - 支持JSON文件加载
class LanguageManager {
    constructor() {
        this.currentLanguage = 'zh-CN';
        this.translations = {};
        this.loadedLanguages = new Set();
        this.languageNames = {
            'zh-CN': '简体中文',
            'zh-TW': '繁體中文',
            'en': 'English',
            'ja': '日本語',
            'ko': '한국어',
            'fr': 'Français',
            'de': 'Deutsch',
            'ar': 'العربية',
            'ru': 'Русский',
            'hi': 'हिन्दी',
            'es': 'Español'
        };
    }
    
    // 异步加载语言文件
    async loadLanguage(langCode) {
        if (this.loadedLanguages.has(langCode)) {
            return; // 已经加载过
        }
        
        try {
            console.log(`🌍 正在加载语言文件: ${langCode}`);
            const response = await fetch(`languages/${langCode}.json`);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}`);
            }
            
            const languageData = await response.json();
            this.translations[langCode] = languageData.translations;
            this.loadedLanguages.add(langCode);
            
            console.log(`✅ 语言文件加载成功: ${langCode}`);
        } catch (error) {
            console.error(`❌ 加载语言文件失败 (${langCode}):`, error);
            // 使用回退的基本翻译
            this.translations[langCode] = this.getFallbackTranslations(langCode);
            this.loadedLanguages.add(langCode);
        }
    }
    
    // 获取回退翻译（基本翻译）
    getFallbackTranslations(langCode) {
        const fallbacks = {
            'zh-CN': {
                title: 'ComfyUI 可视化工作流界面',
                settings: { title: '系统设置' },
                messages: { settingsSaved: '设置已保存' }
            },
            'en': {
                title: 'ComfyUI Visual Workflow Interface',
                settings: { title: 'System Settings' },
                messages: { settingsSaved: 'Settings saved' }
            }
        };
        
        return fallbacks[langCode] || fallbacks['zh-CN'];
    }
    
    // 设置语言
    async setLanguage(langCode) {
        if (!this.loadedLanguages.has(langCode)) {
            await this.loadLanguage(langCode);
        }
        
        this.currentLanguage = langCode;
        console.log(`🌍 语言已切换为: ${langCode} (${this.languageNames[langCode]})`);
        this.updateUI();
    }
    
    // 获取翻译文本
    t(keyPath) {
        const translation = this.translations[this.currentLanguage];
        if (!translation) {
            console.warn(`翻译不存在: ${this.currentLanguage}`);
            return keyPath;
        }
        
        // 支持嵌套键路径，如 'settings.title'
        const keys = keyPath.split('.');
        let value = translation;
        
        for (const key of keys) {
            if (value && typeof value === 'object' && key in value) {
                value = value[key];
            } else {
                return keyPath; // 返回原始键名如果找不到翻译
            }
        }
        
        return value || keyPath;
    }
    
    // 更新界面文本
    updateUI() {
        // 页面标题始终保持为产品名称，不进行翻译
        document.title = 'ComfyUI_XLWEB';
        
        // 更新所有带有 data-i18n 属性的元素，但排除标题
        const elementsToTranslate = document.querySelectorAll('[data-i18n]');
        elementsToTranslate.forEach(element => {
            const key = element.getAttribute('data-i18n');
            
            // 如果是标题元素，保持原始品牌名称，不进行翻译
            if (key === 'title') {
                element.textContent = 'ComfyUI_XLWEB';
                return;
            }
            
            const translation = this.t(key);
            if (translation && translation !== key) {
                element.textContent = translation;
            }
        });
        
        // 更新输入框占位符
        const placeholderElements = document.querySelectorAll('[data-i18n-placeholder]');
        placeholderElements.forEach(element => {
            const key = element.getAttribute('data-i18n-placeholder');
            const translation = this.t(key);
            if (translation && translation !== key) {
                element.placeholder = translation;
            }
        });
        
        // 更新提示文本
        const titleElements = document.querySelectorAll('[data-i18n-title]');
        titleElements.forEach(element => {
            const key = element.getAttribute('data-i18n-title');
            const translation = this.t(key);
            if (translation && translation !== key) {
                element.title = translation;
            }
        });
        
        console.log(`🔄 界面文本已更新为: ${this.languageNames[this.currentLanguage]}`);
    }
    
    // 获取当前语言
    getCurrentLanguage() {
        return this.currentLanguage;
    }
    
    // 获取语言名称
    getLanguageName(langCode) {
        return this.languageNames[langCode] || langCode;
    }
    
    // 获取所有支持的语言
    getSupportedLanguages() {
        return Object.keys(this.languageNames);
    }
}

// ============ 多媒体结果处理 ============

// 结果管理器
class ResultsManager {
    constructor() {
        this.results = {
            images: [],
            videos: [],
            audios: [],
            others: []
        };
        this.isLoading = false;
        this.refreshInterval = null;
        this.startTime = null;
        this.elapsedTimer = null;
    }

    // 初始化结果管理器
    init() {
        this.setupEventListeners();
        this.startAutoRefresh();
    }

    // 设置事件监听器
    setupEventListeners() {
        // 刷新按钮
        const refreshBtn = document.getElementById('refresh-btn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => this.refreshResults());
        }

        // 清除结果按钮
        const clearBtn = document.getElementById('clear-results-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => this.clearResults());
        }

        // 下载全部按钮
        const downloadBtn = document.getElementById('download-all-btn');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', () => this.downloadAllResults());
        }
    }

    // 开始自动刷新
    startAutoRefresh() {
        this.refreshInterval = setInterval(() => {
            if (!this.isLoading) {
                this.refreshResults(false); // 静默刷新
            }
        }, 5000); // 每5秒刷新一次
    }

    // 停止自动刷新
    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
        }
    }

    // 刷新结果
    async refreshResults(showLoading = true) {
        if (this.isLoading) return;

        this.isLoading = true;
        
        if (showLoading) {
            this.updateStatus('loading', '正在获取结果...', 'fas fa-spinner fa-spin');
        }

        try {
            // 获取ComfyUI历史记录
            const response = await fetch(`${getComfyApiUrl()}/history`);
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const history = await response.json();
            await this.processHistory(history);
            this.displayResults();
            
            if (this.hasResults()) {
                this.updateStatus('success', '结果加载完成', 'fas fa-check-circle');
            } else {
                this.updateStatus('empty', '暂无生成结果', 'fas fa-inbox');
            }

        } catch (error) {
            console.error('获取结果失败:', error);
            this.updateStatus('error', '获取结果失败: ' + error.message, 'fas fa-exclamation-triangle');
        } finally {
            this.isLoading = false;
        }
    }

    // 处理历史记录
    async processHistory(history) {
        // 重置结果
        this.results = {
            images: [],
            videos: [],
            audios: [],
            others: []
        };

        if (!history || typeof history !== 'object') {
            return;
        }

        // 遍历历史记录中的每个任务
        for (const [promptId, taskData] of Object.entries(history)) {
            if (taskData && taskData.outputs) {
                await this.processTaskOutputs(taskData.outputs);
            }
        }
    }

    // 处理任务输出
    async processTaskOutputs(outputs) {
        for (const [nodeId, nodeOutputs] of Object.entries(outputs)) {
            // 处理所有类型的输出，不管它们在哪个字段中
            const allOutputTypes = ['images', 'videos', 'audios'];
            
            for (const outputType of allOutputTypes) {
                if (nodeOutputs && nodeOutputs[outputType]) {
                    for (const outputInfo of nodeOutputs[outputType]) {
                        // 不依赖字段名，而是根据文件扩展名确定类型
                        const fileInfo = this.createFileInfoFromOutput(outputInfo, outputType.slice(0, -1)); // 去掉复数s
                        if (fileInfo) {
                            this.categorizeFile(fileInfo);
                        }
                    }
                }
            }
        }
    }

    // 从输出信息创建文件信息
    createFileInfoFromOutput(outputInfo, suggestedType) {
        try {
            const filename = outputInfo.filename;
            const subfolder = outputInfo.subfolder || '';
            
            // 构建正确的ComfyUI API URL
            let url = `${getComfyApiUrl()}/view?filename=${encodeURIComponent(filename)}&type=output`;
            if (subfolder) {
                url += `&subfolder=${encodeURIComponent(subfolder)}`;
            }

            // 根据文件扩展名确定真实的文件类型，而不是依赖传入的建议类型
            const actualType = this.getContentTypeFromExtension(filename);
            const extension = this.getFileExtension(filename);
            
            console.log(`📁 处理文件: ${filename}, 建议类型: ${suggestedType}, 实际类型: ${actualType}`);

            return {
                name: filename,
                url: url,
                type: actualType, // 使用根据扩展名确定的实际类型
                size: 0, // ComfyUI历史记录中通常不包含文件大小
                modified: new Date(),
                extension: extension
            };
        } catch (error) {
            console.error('创建文件信息失败:', outputInfo, error);
            return null;
        }
    }

    // 根据文件扩展名获取内容类型
    getContentTypeFromExtension(filename) {
        const extension = this.getFileExtension(filename);
        const typeMap = {
            'jpg': 'image/jpeg',
            'jpeg': 'image/jpeg',
            'png': 'image/png',
            'gif': 'image/gif',
            'webp': 'image/webp',
            'bmp': 'image/bmp',
            'svg': 'image/svg+xml',
            'mp4': 'video/mp4',
            'webm': 'video/webm',
            'avi': 'video/avi',
            'mov': 'video/quicktime',
            'mp3': 'audio/mpeg',
            'wav': 'audio/wav',
            'ogg': 'audio/ogg',
            'flac': 'audio/flac'
        };
        return typeMap[extension] || 'application/octet-stream';
    }

    // 分类文件
    categorizeFile(fileInfo) {
        const { type, extension } = fileInfo;
        
        if (type.startsWith('image/') || ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(extension)) {
            this.results.images.push(fileInfo);
        } else if (type.startsWith('video/') || ['mp4', 'avi', 'mov', 'wmv', 'flv', 'webm', 'mkv'].includes(extension)) {
            this.results.videos.push(fileInfo);
        } else if (type.startsWith('audio/') || ['mp3', 'wav', 'ogg', 'aac', 'flac', 'm4a'].includes(extension)) {
            this.results.audios.push(fileInfo);
        } else {
            this.results.others.push(fileInfo);
        }
    }

    // 获取文件扩展名
    getFileExtension(filename) {
        return filename.split('.').pop().toLowerCase();
    }

    // 显示结果
    displayResults() {
        const mediaResults = document.getElementById('media-results');
        const resultStatus = document.getElementById('result-status');
        
        if (!mediaResults || !resultStatus) {
            console.warn('Media results or status elements not found');
            return;
        }
        
        if (this.hasResults()) {
            mediaResults.classList.add('has-results');
            resultStatus.style.display = 'none';
            
            this.displayImages();
            this.displayVideos();
            this.displayAudios();
            this.displayOthers();
        } else {
            mediaResults.classList.remove('has-results');
            resultStatus.style.display = 'flex';
        }
    }

    // 显示图像结果
    displayImages() {
        const container = document.getElementById('image-grid');
        const countElement = document.getElementById('image-count');
        const section = document.getElementById('image-results');
        
        if (!container || !countElement || !section) {
            console.warn('Image display elements not found');
            return;
        }
        
        if (this.results.images.length === 0) {
            section.style.display = 'none';
            return;
        }
        
        section.style.display = 'block';
        countElement.textContent = this.results.images.length;
        container.innerHTML = '';
        
        this.results.images.forEach(image => {
            const item = this.createMediaItem(image, 'image');
            container.appendChild(item);
        });
    }

    // 显示视频结果
    displayVideos() {
        const container = document.getElementById('video-grid');
        const countElement = document.getElementById('video-count');
        const section = document.getElementById('video-results');
        
        if (!container || !countElement || !section) {
            console.warn('Video display elements not found');
            return;
        }
        
        if (this.results.videos.length === 0) {
            section.style.display = 'none';
            return;
        }
        
        section.style.display = 'block';
        countElement.textContent = this.results.videos.length;
        container.innerHTML = '';
        
        this.results.videos.forEach(video => {
            const item = this.createMediaItem(video, 'video');
            container.appendChild(item);
        });
    }

    // 显示音频结果
    displayAudios() {
        const container = document.getElementById('audio-grid');
        const countElement = document.getElementById('audio-count');
        const section = document.getElementById('audio-results');
        
        if (!container || !countElement || !section) {
            console.warn('Audio display elements not found');
            return;
        }
        
        if (this.results.audios.length === 0) {
            section.style.display = 'none';
            return;
        }
        
        section.style.display = 'block';
        countElement.textContent = this.results.audios.length;
        container.innerHTML = '';
        
        this.results.audios.forEach(audio => {
            const item = this.createMediaItem(audio, 'audio');
            container.appendChild(item);
        });
    }

    // 显示其他文件
    displayOthers() {
        const container = document.getElementById('other-list');
        const countElement = document.getElementById('other-count');
        const section = document.getElementById('other-results');
        
        if (!container || !countElement || !section) {
            console.warn('Other files display elements not found');
            return;
        }
        
        if (this.results.others.length === 0) {
            section.style.display = 'none';
            return;
        }
        
        section.style.display = 'block';
        countElement.textContent = this.results.others.length;
        container.innerHTML = '';
        
        this.results.others.forEach(file => {
            const item = this.createFileItem(file);
            container.appendChild(item);
        });
    }

    // 创建媒体项目
    createMediaItem(fileInfo, type) {
        const item = document.createElement('div');
        item.className = 'media-item';
        item.onclick = () => this.openMediaPreview(fileInfo);
        
        let mediaElement = '';
        if (type === 'image') {
            mediaElement = `<img src="${fileInfo.url}" alt="${fileInfo.name}" loading="lazy">`;
        } else if (type === 'video') {
            mediaElement = `<video src="${fileInfo.url}" preload="metadata" muted></video>`;
        } else if (type === 'audio') {
            mediaElement = `<audio src="${fileInfo.url}" controls preload="metadata"></audio>`;
        }
        
        item.innerHTML = `
            ${mediaElement}
            <div class="media-actions">
                <button class="action-btn" onclick="event.stopPropagation(); window.resultsManager.downloadFile('${fileInfo.url}', '${fileInfo.name}')" title="下载">
                    <i class="fas fa-download"></i>
                </button>
                <button class="action-btn" onclick="event.stopPropagation(); window.resultsManager.shareFile('${fileInfo.url}')" title="分享">
                    <i class="fas fa-share"></i>
                </button>
            </div>
            <div class="media-info">
                <p class="media-name">${fileInfo.name}</p>
                <p class="media-size">${this.formatFileSize(fileInfo.size)}</p>
            </div>
        `;
        
        return item;
    }

    // 创建文件项目
    createFileItem(fileInfo) {
        const item = document.createElement('div');
        item.className = 'file-item';
        item.onclick = () => this.downloadFile(fileInfo.url, fileInfo.name);
        
        const icon = this.getFileIcon(fileInfo.extension);
        
        item.innerHTML = `
            <div class="file-icon">
                <i class="${icon}"></i>
            </div>
            <div class="file-info">
                <p class="file-name">${fileInfo.name}</p>
                <p class="file-details">${this.formatFileSize(fileInfo.size)} • ${this.formatDate(fileInfo.modified)}</p>
            </div>
        `;
        
        return item;
    }

    // 获取文件图标
    getFileIcon(extension) {
        const iconMap = {
            'pdf': 'fas fa-file-pdf',
            'doc': 'fas fa-file-word',
            'docx': 'fas fa-file-word',
            'xls': 'fas fa-file-excel',
            'xlsx': 'fas fa-file-excel',
            'ppt': 'fas fa-file-powerpoint',
            'pptx': 'fas fa-file-powerpoint',
            'txt': 'fas fa-file-alt',
            'zip': 'fas fa-file-archive',
            'rar': 'fas fa-file-archive',
            '7z': 'fas fa-file-archive',
            'json': 'fas fa-file-code',
            'xml': 'fas fa-file-code',
            'csv': 'fas fa-file-csv'
        };
        
        return iconMap[extension] || 'fas fa-file';
    }

    // 格式化文件大小
    formatFileSize(bytes) {
        if (bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    }

    // 格式化日期
    formatDate(date) {
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    }

    // 检查是否有结果
    hasResults() {
        return this.results.images.length > 0 || 
               this.results.videos.length > 0 || 
               this.results.audios.length > 0 || 
               this.results.others.length > 0;
    }

    // 更新状态
    updateStatus(type, message, icon) {
        const statusElement = document.getElementById('result-status');
        if (!statusElement) {
            console.warn('result-status element not found');
            return;
        }
        
        const iconElement = statusElement.querySelector('.status-icon i');
        const textElement = statusElement.querySelector('.status-text h3');
        const descElement = statusElement.querySelector('.status-text p');
        
        if (!iconElement || !textElement || !descElement) {
            console.warn('Status elements not found:', { iconElement, textElement, descElement });
            return;
        }
        
        iconElement.className = icon;
        textElement.textContent = message;
        
        switch (type) {
            case 'loading':
                descElement.textContent = '请稍候...';
                break;
            case 'success':
                descElement.textContent = '点击文件可以预览或下载';
                break;
            case 'empty':
                descElement.textContent = '运行工作流后结果将显示在这里';
                break;
            case 'error':
                descElement.textContent = '请检查网络连接或服务器状态';
                break;
        }
    }

    // 清除结果
    clearResults() {
        if (confirm('确定要清除所有结果吗？这将删除服务器上的输出文件。')) {
            // 这里可以添加清除服务器文件的API调用
            this.results = {
                images: [],
                videos: [],
                audios: [],
                others: []
            };
            this.displayResults();
            this.updateStatus('empty', '结果已清除', 'fas fa-inbox');
        }
    }

    // 下载文件
    downloadFile(url, filename) {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
    }

    // 下载所有结果
    downloadAllResults() {
        const allFiles = [
            ...this.results.images,
            ...this.results.videos,
            ...this.results.audios,
            ...this.results.others
        ];
        
        if (allFiles.length === 0) {
            alert('没有可下载的文件');
            return;
        }
        
        allFiles.forEach((file, index) => {
            setTimeout(() => {
                this.downloadFile(file.url, file.name);
            }, index * 100); // 延迟下载避免浏览器阻止
        });
    }

    // 分享文件
    shareFile(url) {
        if (navigator.share) {
            navigator.share({
                title: '生成结果',
                url: url
            });
        } else {
            // 复制链接到剪贴板
            navigator.clipboard.writeText(url).then(() => {
                alert('链接已复制到剪贴板');
            });
        }
    }

    // 打开媒体预览
    openMediaPreview(fileInfo) {
        // 这里可以实现媒体预览功能
        window.open(fileInfo.url, '_blank');
    }
}

// 结果详情面板控制
function closeResultDetails() {
    const detailsPanel = document.getElementById('result-details');
    detailsPanel.classList.remove('open');
}

// 全局结果管理器实例
window.resultsManager = new ResultsManager();

// 在DOM加载完成后初始化结果管理器
document.addEventListener('DOMContentLoaded', function() {
    if (window.resultsManager) {
        window.resultsManager.init();
    }
});

// 导出的控制函数
function refreshResults() {
    if (window.resultsManager) {
        window.resultsManager.refreshResults();
    }
}

function clearResults() {
    if (window.resultsManager) {
        window.resultsManager.clearResults();
    }
}

function downloadAllResults() {
    if (window.resultsManager) {
        window.resultsManager.downloadAllResults();
    }
}

// 错误处理
window.addEventListener('error', (event) => {
    console.error('应用错误:', event.error);
});

// 图片加载错误处理
document.addEventListener('error', (event) => {
    if (event.target.tagName === 'IMG') {
        event.target.src = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjAwIiBoZWlnaHQ9IjIwMCIgdmlld0JveD0iMCAwIDIwMCAyMDAiIGZpbGw9Im5vbmUiIHhtbG5zPSJodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2ZyI+CjxyZWN0IHdpZHRoPSIyMDAiIGhlaWdodD0iMjAwIiBmaWxsPSIjRjNGNEY2Ii8+CjxwYXRoIGQ9Ik0xMDAgMTMzQzExNy4zMiAxMzMgMTMxLjUgMTE4LjgyIDEzMS41IDEwMS41QzEzMS41IDg0LjE4MDEgMTE3LjMyIDcwIDEwMCA3MEM4Mi42ODAxIDcwIDY4LjUgODQuMTgwMSA2OC41IDEwMS41QzY4LjUgMTE4LjgyIDgyLjY4MDEgMTMzIDEwMCAxMzNaIiBmaWxsPSIjOUE5QUE5Ii8+Cjwvc3ZnPgo=';
        event.target.alt = '图片加载失败';
    }
}, true);

// 初始化结果管理器
document.addEventListener('DOMContentLoaded', () => {
    // 确保DOM完全加载后再初始化ResultsManager
    if (typeof ResultsManager !== 'undefined') {
        window.resultsManager = new ResultsManager();
        console.log('ResultsManager initialized successfully');
    } else {
        console.error('ResultsManager class not found');
    }
});

// 如果DOMContentLoaded已经触发，立即初始化
if (document.readyState === 'loading') {
    // DOM还在加载中，等待DOMContentLoaded事件
} else {
    // DOM已经加载完成，立即初始化
    if (typeof ResultsManager !== 'undefined' && !window.resultsManager) {
        window.resultsManager = new ResultsManager();
        console.log('ResultsManager initialized immediately');
    }
}