class ComfyUIInterface {
    constructor() {
        // 从设置中加载服务器地址，如果没有设置则使用默认值
        this.comfyUIUrl = this.getServerUrlFromSettings();
        this.websocket = null;
        this.currentWorkflow = null;
        this.currentTaskId = null;
        this.isConnected = false;
        this.wsFailbackAttempted = false; // WebSocket回退尝试标记
        
        this.init();
    }
    
    // 从设置中获取服务器URL
    getServerUrlFromSettings() {
        try {
            const settings = localStorage.getItem('comfyui-settings');
            if (settings) {
                const parsedSettings = JSON.parse(settings);
                if (parsedSettings.serverIp) {
                    const serverUrl = this.normalizeServerUrl(parsedSettings.serverIp);
                    console.log('🌐 从设置加载服务器地址:', serverUrl);
                    console.log('📝 原始设置值:', parsedSettings.serverIp);
                    return serverUrl;
                }
            }
        } catch (error) {
            console.error('加载服务器设置失败:', error);
        }
        
        // 动态获取当前ComfyUI服务器地址
        const currentUrl = `${window.location.protocol}//${window.location.host}`;
        console.log('🌐 使用当前ComfyUI服务器地址:', currentUrl);
        console.log('⚠️ 未找到保存的服务器设置，使用默认地址');
        return currentUrl;
    }
    
    // 检测是否为IPv6地址的辅助函数
    isIPv6Address(address) {
        // 移除方括号（如果有）
        const cleanAddress = address.replace(/^\[|\]$/g, '');
        
        // IPv6地址模式检测
        const ipv6Pattern = /^([0-9a-fA-F]{0,4}:){1,7}[0-9a-fA-F]{0,4}$|^::([0-9a-fA-F]{0,4}:){0,6}[0-9a-fA-F]{0,4}$|^([0-9a-fA-F]{0,4}:){1,6}::$|^([0-9a-fA-F]{0,4}:){1,5}:([0-9a-fA-F]{0,4}:){1,1}[0-9a-fA-F]{0,4}$|^([0-9a-fA-F]{0,4}:){1,4}:([0-9a-fA-F]{0,4}:){1,2}[0-9a-fA-F]{0,4}$|^([0-9a-fA-F]{0,4}:){1,3}:([0-9a-fA-F]{0,4}:){1,3}[0-9a-fA-F]{0,4}$|^([0-9a-fA-F]{0,4}:){1,2}:([0-9a-fA-F]{0,4}:){1,4}[0-9a-fA-F]{0,4}$|^[0-9a-fA-F]{0,4}::([0-9a-fA-F]{0,4}:){1,5}[0-9a-fA-F]{0,4}$|^::([0-9a-fA-F]{0,4}:){0,5}[0-9a-fA-F]{0,4}$|^([0-9a-fA-F]{0,4}:){1,7}:$|^::[0-9a-fA-F]{0,4}$|^::$/;
        
        // 检测链路本地地址（包含%）
        const linkLocalPattern = /^([0-9a-fA-F]{0,4}:){1,7}[0-9a-fA-F]{0,4}%[a-zA-Z0-9]+$/;
        
        return ipv6Pattern.test(cleanAddress) || linkLocalPattern.test(cleanAddress);
    }

    // 检测是否为域名的辅助函数
    isDomain(address) {
        // 域名模式检测（包含字母且有点分隔）
        const domainPattern = /^([a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)+[a-zA-Z]{2,}$/;
        const localhostPattern = /^localhost$/i;
        
        return domainPattern.test(address) || localhostPattern.test(address);
    }

    // 标准化服务器URL格式 - 增强支持IPv6和域名
    normalizeServerUrl(input) {
        if (!input || input.trim() === '') {
            return 'http://localhost:8188';
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
        if (this.isIPv6Address(serverUrl)) {
            // 纯IPv6地址，添加方括号和默认端口
            return `http://[${serverUrl}]:8188`;
        }
        
        // 检查是否为域名
        if (this.isDomain(serverUrl)) {
            // 纯域名，添加默认端口
            return `http://${serverUrl}:8188`;
        }
        
        // 检查是否包含端口（IPv4:port 或 domain:port）
        if (serverUrl.includes(':')) {
            // 检查是否为域名:端口格式
            const parts = serverUrl.split(':');
            if (parts.length === 2 && this.isDomain(parts[0])) {
                return `http://${serverUrl}`;
            }
            // IPv4:端口格式，添加 http:// 前缀
            return `http://${serverUrl}`;
        }
        
        // 纯IP地址或localhost，添加默认端口和协议
        return `http://${serverUrl}:8188`;
    }
    
    // 更新服务器URL
    updateServerUrl(newServerIp) {
        const newUrl = this.normalizeServerUrl(newServerIp);
        console.log('🔄 更新服务器地址请求:', this.comfyUIUrl, '->', newUrl);
        console.log('📝 输入的服务器IP:', newServerIp);
        
        // 强制更新，即使URL相同也要重新设置
        this.comfyUIUrl = newUrl;
        
        // 更新设置中的服务器地址
        if (window.settingsManager) {
            const extractedAddress = this.extractServerAddress(newUrl);
            window.settingsManager.setSetting('serverIp', extractedAddress);
            window.settingsManager.saveSettings();
            console.log('💾 服务器地址已更新到设置:', extractedAddress);
        }
        
        // 重新连接WebSocket
        this.connectWebSocket();
        
        // 重新检查连接状态
        this.checkConnectionStatus().then(connected => {
            this.updateConnectionStatus(connected);
        });
        
        // 显示通知
        if (typeof showNotification === 'function') {
            const message = window.languageManager ? 
                `${window.languageManager.t('interface.serverAddressUpdated')} ${this.extractServerAddress(newUrl)}` :
                `服务器地址已更新为: ${this.extractServerAddress(newUrl)}`;
            showNotification(message, 'success');
        }
        
        console.log('✅ 服务器地址更新完成，当前URL:', this.comfyUIUrl);
        
        // 刷新已显示的结果，使用新的服务器地址
        this.refreshDisplayedResults();
    }
    
    // 刷新已显示的结果，更新URL为新的服务器地址
    refreshDisplayedResults() {
        console.log('🔄 刷新显示的结果，使用新服务器地址:', this.comfyUIUrl);
        
        // 刷新图像结果
        const imageGrid = document.getElementById('image-grid');
        if (imageGrid) {
            const images = imageGrid.querySelectorAll('img');
            images.forEach(img => {
                const oldSrc = img.src;
                if (oldSrc.includes('/api/view')) {
                    const urlParams = new URL(oldSrc).search;
                    const newSrc = `${this.comfyUIUrl}/api/view${urlParams}`;
                    img.src = newSrc;
                    console.log('🖼️ 更新图像URL:', oldSrc, '->', newSrc);
                }
            });
        }
        
        // 刷新视频结果
        const videoGrid = document.getElementById('video-grid');
        if (videoGrid) {
            const videos = videoGrid.querySelectorAll('video');
            videos.forEach(video => {
                const sources = video.querySelectorAll('source');
                sources.forEach(source => {
                    const oldSrc = source.src;
                    if (oldSrc.includes('/api/view')) {
                        const urlParams = new URL(oldSrc).search;
                        const newSrc = `${this.comfyUIUrl}/api/view${urlParams}`;
                        source.src = newSrc;
                        console.log('🎥 更新视频URL:', oldSrc, '->', newSrc);
                    }
                });
                // 重新加载视频
                video.load();
            });
        }
        
        // 刷新历史记录
        if (window.resultsManager) {
            window.resultsManager.renderHistory();
        }
    }
    
    // 提取服务器地址用于显示和保存 - 增强支持IPv6
    extractServerAddress(normalizedUrl) {
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

    init() {
        this.setupEventListeners();
        this.loadWorkflowFromUrl();
        this.connectWebSocket();
        this.loadHistory();
    }

    setupEventListeners() {
        // 文件上传事件委托
        document.addEventListener('change', (e) => {
            if (e.target.classList.contains('file-input')) {
                this.handleFileUpload(e);
            }
        });
        
        // 文件上传按钮点击事件
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('file-input-btn') || e.target.closest('.file-input-btn')) {
                const button = e.target.classList.contains('file-input-btn') ? e.target : e.target.closest('.file-input-btn');
                const fileInput = button.parentElement.querySelector('.file-input');
                if (fileInput) {
                    fileInput.click();
                }
            }
        });

        // 提示词变化事件
        const positivePrompt = document.getElementById('positive-prompt');
        const negativePrompt = document.getElementById('negative-prompt');
        
        if (positivePrompt) {
            positivePrompt.addEventListener('input', () => this.updatePromptInWorkflow('positive', positivePrompt.value));
        }
        
        if (negativePrompt) {
            negativePrompt.addEventListener('input', () => this.updatePromptInWorkflow('negative', negativePrompt.value));
        }

        // 随机种子复选框事件
        const randomSeedCheckbox = document.getElementById('random-seed');
        if (randomSeedCheckbox) {
            randomSeedCheckbox.addEventListener('change', () => this.toggleSeedValueDisplay());
        }
    }

    // 从URL参数加载工作流
    loadWorkflowFromUrl() {
        const urlParams = new URLSearchParams(window.location.search);
        const workflowPath = urlParams.get('workflow');
        
        if (workflowPath) {
            this.loadWorkflow(workflowPath);
        }
    }

    // 加载工作流JSON文件
    async loadWorkflow(workflowPath) {
        try {
            this.showLoading(true);
            const response = await fetch(workflowPath);
            
            if (!response.ok) {
                throw new Error(`无法加载工作流: ${response.statusText}`);
            }
            
            const workflow = await response.json();
            this.currentWorkflow = workflow;
            
            this.parseWorkflow(workflow);
            this.updateConnectionStatus(true);
            
        } catch (error) {
            console.error('加载工作流失败:', error);
            this.showError('加载工作流失败: ' + error.message);
        } finally {
            this.showLoading(false);
        }
    }

    // 解析工作流并更新UI
    parseWorkflow(workflow) {
        // 首先检测并修复工作流中的提示词冲突
        this.detectAndFixWorkflowConflicts(workflow);
        
        this.updatePromptInputs(workflow);
        this.updateSeedControl(workflow);
        this.updateUploadControls(workflow);
    }

    // 检测并修复工作流中的提示词冲突
    detectAndFixWorkflowConflicts(workflow) {
        console.log('🔍 检测工作流中是否存在提示词冲突...');
        
        // 获取正面和反面提示词的节点信息
        const positiveInfo = this.getPromptNodeInfo(workflow, 'positive');
        const negativeInfo = this.getPromptNodeInfo(workflow, 'negative');
        
        if (!positiveInfo || !negativeInfo) {
            console.log('📝 未找到完整的正面/反面提示词节点，跳过冲突检测');
            return;
        }
        
        // 检查是否存在冲突
        const conflict = this.detectNodeConflict(positiveInfo, negativeInfo);
        
        if (conflict) {
            console.log(`⚠️ 工作流加载时检测到提示词冲突: ${conflict.description}`);
            
            // 获取冲突节点的当前内容
            const conflictNode = workflow[conflict.nodeId];
            if (conflictNode && conflictNode.inputs && conflictNode.inputs.text !== undefined) {
                const currentContent = conflictNode.inputs.text;
                console.log(`📝 冲突节点 ${conflict.nodeId} 当前内容: "${currentContent}"`);
                
                // 检查内容优先级（正面提示词优先）
                const positiveContent = this.getNodeContent(workflow, positiveInfo);
                const negativeContent = this.getNodeContent(workflow, negativeInfo);
                
                console.log(`🔎 正面提示词内容: "${positiveContent}"`);
                console.log(`🔎 反面提示词内容: "${negativeContent}"`);
                
                // 如果正面提示词有内容，保持正面提示词，清空反面提示词
                if (positiveContent && positiveContent.trim()) {
                    console.log('🛡️ 检测到正面提示词有内容，应用正面优先策略');
                    
                    // 设置冲突节点为正面提示词内容
                    conflictNode.inputs.text = positiveContent;
                    
                    // 清空反面提示词节点
                    this.clearNegativePromptNode(workflow, negativeInfo);
                    
                    console.log(`✅ 冲突已解决: 节点 ${conflict.nodeId} 使用正面提示词，反面提示词已清空`);
                }
                // 如果只有反面提示词有内容，清空冲突节点（保持反面提示词为空）
                else if (negativeContent && negativeContent.trim()) {
                    console.log('⚠️ 只有反面提示词有内容，但由于冲突，将清空冲突节点');
                    
                    // 清空冲突节点
                    conflictNode.inputs.text = '';
                    
                    // 清空反面提示词节点
                    this.clearNegativePromptNode(workflow, negativeInfo);
                    
                    console.log(`✅ 冲突已解决: 为保持正面优先策略，所有冲突节点已清空`);
                }
            }
        } else {
            console.log('✅ 工作流结构正常，未检测到提示词冲突');
        }
    }
    
    // 获取节点内容
    getNodeContent(workflow, nodeInfo) {
        if (!nodeInfo || !workflow[nodeInfo.targetNodeId]) return '';
        
        const node = workflow[nodeInfo.targetNodeId];
        if (node.inputs) {
            if (nodeInfo.fieldName === 'text' && node.inputs.text !== undefined) {
                return node.inputs.text;
            }
            if (nodeInfo.fieldName === 'positive' && node.inputs.positive !== undefined) {
                return node.inputs.positive;
            }
            if (nodeInfo.fieldName === 'negative' && node.inputs.negative !== undefined) {
                return node.inputs.negative;
            }
        }
        return '';
    }
    
    // 清空反面提示词节点
    clearNegativePromptNode(workflow, negativeInfo) {
        if (!negativeInfo || !workflow[negativeInfo.targetNodeId]) return;
        
        const negativeNode = workflow[negativeInfo.targetNodeId];
        if (negativeNode.inputs) {
            if (negativeInfo.fieldName === 'text' && negativeNode.inputs.text !== undefined) {
                negativeNode.inputs.text = '';
                console.log(`🔄 已清空反面提示词节点 ${negativeInfo.targetNodeId} 的 text 字段`);
            }
            if (negativeInfo.fieldName === 'negative' && negativeNode.inputs.negative !== undefined) {
                negativeNode.inputs.negative = '';
                console.log(`🔄 已清空反面提示词节点 ${negativeInfo.targetNodeId} 的 negative 字段`);
            }
        }
    }
    
    // 更新提示词输入框
    updatePromptInputs(workflow) {
        // 从修复后的工作流中重新获取提示词内容
        const positivePrompt = this.findPromptValue(workflow, 'positive');
        const negativePrompt = this.findPromptValue(workflow, 'negative');
        
        const positiveInput = document.getElementById('positive-prompt');
        const negativeInput = document.getElementById('negative-prompt');
        const promptGroup = document.getElementById('prompt-group');
        
        if (positivePrompt !== null) {
            positiveInput.value = positivePrompt;
            positiveInput.style.display = 'block';
            console.log(`📝 正面提示词输入框已更新: "${positivePrompt}"`);
        } else {
            positiveInput.style.display = 'none';
        }
        
        if (negativePrompt !== null) {
            negativeInput.value = negativePrompt;
            negativeInput.style.display = 'block';
            console.log(`📝 反面提示词输入框已更新: "${negativePrompt}"`);
        } else {
            negativeInput.style.display = 'none';
            console.log('📝 反面提示词输入框已隐藏（无内容或已被清空）');
        }
        
        // 如果都没有找到，隐藏整个提示词组
        if (positivePrompt === null && negativePrompt === null) {
            promptGroup.style.display = 'none';
        } else {
            promptGroup.style.display = 'block';
        }
    }

    // 查找提示词值
    findPromptValue(workflow, type) {
        const inputKey = type === 'positive' ? 'positive' : 'negative';
        
        console.log(`🔍 查找 ${type} 提示词值...`);
        
        for (const nodeId in workflow) {
            const node = workflow[nodeId];
            if (node.inputs && node.inputs[inputKey] !== undefined) {
                console.log(`🔎 找到引用节点 ${nodeId}, ${inputKey} = ${JSON.stringify(node.inputs[inputKey])}`);
                
                // 如果是字符串，直接返回
                if (typeof node.inputs[inputKey] === 'string') {
                    console.log(`✅ 直接字符串类型: "${node.inputs[inputKey]}"`);
                    return node.inputs[inputKey];
                }
                // 如果是数组，说明连接了其他节点，需要追踪
                if (Array.isArray(node.inputs[inputKey])) {
                    const connectedNodeId = node.inputs[inputKey][0];
                    console.log(`🔗 连接到节点: ${connectedNodeId}`);
                    
                    // 支持层级节点ID（如 "153:89"）
                    const textValue = this.findTextInNode(workflow, connectedNodeId, type);
                    if (textValue !== null) {
                        console.log(`✅ 找到连接节点的文本: "${textValue}"`);
                        return textValue;
                    }
                }
            }
        }
        
        console.log(`❌ 未找到 ${type} 提示词`);
        return null;
    }

    // 在节点中查找text值（支持层级节点ID）
    findTextInNode(workflow, nodeId, targetType = null) {
        console.log(`🔍 在节点 ${nodeId} 中查找text值... (目标类型: ${targetType})`);
        
        const node = workflow[nodeId];
        if (!node || !node.inputs) {
            console.log(`❌ 节点 ${nodeId} 不存在或无inputs`);
            return null;
        }
        
        // 显示节点信息以便调试
        console.log(`📝 节点 ${nodeId} 信息:`, {
            class_type: node.class_type,
            title: node._meta?.title,
            inputs: Object.keys(node.inputs || {})
        });
        
        // 优先查找text
        if (node.inputs.text !== undefined) {
            if (typeof node.inputs.text === 'string') {
                console.log(`✅ 找到text字段: "${node.inputs.text}"`);
                return node.inputs.text;
            }
            if (Array.isArray(node.inputs.text)) {
                const connectedNodeId = node.inputs.text[0];
                console.log(`🔗 text字段连接到节点: ${connectedNodeId}`);
                return this.findTextInNode(workflow, connectedNodeId, targetType);
            }
        }
        
        // 根据目标类型查找对应字段
        if (targetType === 'negative' && node.inputs.negative !== undefined) {
            if (typeof node.inputs.negative === 'string') {
                console.log(`✅ 找到negative字段: "${node.inputs.negative}"`);
                return node.inputs.negative;
            }
            if (Array.isArray(node.inputs.negative)) {
                const connectedNodeId = node.inputs.negative[0];
                console.log(`🔗 negative字段连接到节点: ${connectedNodeId}`);
                return this.findTextInNode(workflow, connectedNodeId, targetType);
            }
        }
        
        // 如果没有找到negative或目标类型是positive，查找positive
        if (node.inputs.positive !== undefined) {
            if (typeof node.inputs.positive === 'string') {
                console.log(`✅ 找到positive字段: "${node.inputs.positive}"`);
                return node.inputs.positive;
            }
            if (Array.isArray(node.inputs.positive)) {
                const connectedNodeId = node.inputs.positive[0];
                console.log(`🔗 positive字段连接到节点: ${connectedNodeId}`);
                return this.findTextInNode(workflow, connectedNodeId, targetType);
            }
        }
        
        console.log(`❌ 节点 ${nodeId} 中未找到有效的文本内容`);
        return null;
    }

    // 更新种子控制
    updateSeedControl(workflow) {
        const shouldShow = this.shouldShowSeedControls(workflow);
        const seedGroup = document.getElementById('seed-group');
        const seedValueDisplay = document.getElementById('seed-value-display');
        const currentSeedValue = document.getElementById('current-seed-value');
        
        if (shouldShow) {
            seedGroup.style.display = 'block';
            
            // 获取当前工作流中的种子值
            const currentSeed = this.getCurrentSeedFromWorkflow(workflow);
            if (currentSeed !== null && seedValueDisplay && currentSeedValue) {
                seedValueDisplay.style.display = 'block';
                // 显示种子值和类型
                currentSeedValue.textContent = `${currentSeed.value} (${currentSeed.type})`;
                console.log('🎲 显示种子信息:', currentSeed);
            }
        } else {
            seedGroup.style.display = 'none';
        }
    }

    // 检查工作流中是否有seed或noise_seed
    hasSeedInWorkflow(workflow) {
        for (const nodeId in workflow) {
            const node = workflow[nodeId];
            if (node.inputs && (node.inputs.seed !== undefined || node.inputs.noise_seed !== undefined)) {
                return true;
            }
        }
        return false;
    }

    // 获取当前工作流中的种子值（优先显示seed，其次是noise_seed）
    getCurrentSeedFromWorkflow(workflow) {
        // 首先查找 seed 字段
        for (const nodeId in workflow) {
            const node = workflow[nodeId];
            if (node.inputs && node.inputs.seed !== undefined) {
                return { type: 'seed', value: node.inputs.seed, nodeId };
            }
        }
        
        // 如果没有seed，再查找noise_seed
        for (const nodeId in workflow) {
            const node = workflow[nodeId];
            if (node.inputs && node.inputs.noise_seed !== undefined) {
                return { type: 'noise_seed', value: node.inputs.noise_seed, nodeId };
            }
        }
        
        return null;
    }

    // 切换种子数值显示
    toggleSeedValueDisplay() {
        const randomSeedCheckbox = document.getElementById('random-seed');
        const seedValueDisplay = document.getElementById('seed-value-display');
        const currentSeedValue = document.getElementById('current-seed-value');
        
        if (randomSeedCheckbox && seedValueDisplay && currentSeedValue) {
            if (randomSeedCheckbox.checked) {
                // 显示当前工作流中的种子值
                if (this.currentWorkflow) {
                    const currentSeed = this.getCurrentSeedFromWorkflow(this.currentWorkflow);
                    if (currentSeed !== null) {
                        seedValueDisplay.style.display = 'block';
                        // 显示种子值和类型
                        currentSeedValue.textContent = `${currentSeed.value} (${currentSeed.type})`;
                    }
                }
            } else {
                // 隐藏种子数值显示
                seedValueDisplay.style.display = 'none';
            }
        }
    }

    // 更新上传控件
    updateUploadControls(workflow) {
        this.updateImageUploads(workflow);
        this.updateVideoUploads(workflow);
        this.updateAudioUploads(workflow);
        
        // 检查是否有上传组件，没有则隐藏整个上传组
        this.updateUploadGroupVisibility();
    }

    // 更新图像上传
    updateImageUploads(workflow) {
        const imageNodes = this.findNodesByClassType(workflow, 'LoadImage');
        const container = document.getElementById('image-uploads');
        container.innerHTML = '';
        
        if (imageNodes.length > 0) {
            imageNodes.forEach((nodeId, index) => {
                this.createUploadComponent(container, 'image', `图像上传 ${index + 1}`, nodeId);
            });
        }
    }

    // 更新视频上传
    updateVideoUploads(workflow) {
        const videoNodes = this.findNodesByClassType(workflow, ['LoadVideo', 'VHS_LoadVideo', 'VHS_LoadVideoFFmpeg']);
        const container = document.getElementById('video-uploads');
        container.innerHTML = '';
        
        if (videoNodes.length > 0) {
            videoNodes.forEach((nodeId, index) => {
                this.createUploadComponent(container, 'video', `视频上传 ${index + 1}`, nodeId);
            });
        }
    }

    // 更新音频上传
    updateAudioUploads(workflow) {
        const audioNodes = this.findNodesByClassType(workflow, ['LoadAudio', 'VHS_LoadAudio']);
        const container = document.getElementById('audio-uploads');
        container.innerHTML = '';
        
        if (audioNodes.length > 0) {
            audioNodes.forEach((nodeId, index) => {
                this.createUploadComponent(container, 'audio', `音频上传 ${index + 1}`, nodeId);
            });
        }
    }

    // 根据class_type查找节点（支持显示控制）
    findNodesByClassType(workflow, classTypes) {
        const nodes = [];
        const types = Array.isArray(classTypes) ? classTypes : [classTypes];
        
        for (const nodeId in workflow) {
            const node = workflow[nodeId];
            if (!node.class_type) continue;
            
            // 检查节点可见性控制
            const visibility = this.getNodeVisibility(node.class_type);
            const cleanClassType = this.getCleanClassType(node.class_type);
            
            // 如果节点被强制隐藏，跳过
            if (visibility === 'hidden') {
                console.log(`🙈 节点 ${nodeId} (${node.class_type}) 被强制隐藏，不在网页上显示`);
                continue;
            }
            
            // 检查是否匹配类型
            if (types.includes(cleanClassType)) {
                // 如果是强制显示或正常显示，添加到结果中
                if (visibility === 'visible' || visibility === 'normal') {
                    console.log(`✅ 节点 ${nodeId} (${node.class_type}) 将显示在网页上`);
                    nodes.push(nodeId);
                }
            }
        }
        
        return nodes;
    }
    
    // 获取节点可见性
    getNodeVisibility(classType) {
        if (classType.startsWith('.')) {
            return 'hidden';    // 强制隐藏
        } else if (classType.startsWith('#')) {
            return 'visible';   // 强制显示
        } else {
            return 'normal';    // 正常显示
        }
    }
    
    // 获取清洁的class_type（去除控制符）
    getCleanClassType(classType) {
        if (classType.startsWith('.') || classType.startsWith('#')) {
            return classType.substring(1);
        }
        return classType;
    }
    
    // 检查是否应该显示提示词控件
    shouldShowPromptControls(workflow) {
        for (const nodeId in workflow) {
            const node = workflow[nodeId];
            if (!node.class_type) continue;
            
            const visibility = this.getNodeVisibility(node.class_type);
            const cleanClassType = this.getCleanClassType(node.class_type);
            
            // 检查是否是提示词相关节点
            if (cleanClassType === 'CLIPTextEncode' || cleanClassType.includes('TextEncode')) {
                // 如果节点被强制隐藏，不显示控件
                if (visibility === 'hidden') {
                    console.log(`🙈 提示词节点 ${nodeId} (${node.class_type}) 被强制隐藏`);
                    continue;
                }
                // 否则显示控件
                return true;
            }
        }
        return false;
    }
    
    // 检查是否应该显示种子控件
    shouldShowSeedControls(workflow) {
        for (const nodeId in workflow) {
            const node = workflow[nodeId];
            if (!node.class_type || !node.inputs) continue;
            
            const visibility = this.getNodeVisibility(node.class_type);
            
            // 检查是否有种子相关输入
            if (node.inputs.seed !== undefined || node.inputs.noise_seed !== undefined) {
                // 如果节点被强制隐藏，不显示控件
                if (visibility === 'hidden') {
                    console.log(`🙈 种子节点 ${nodeId} (${node.class_type}) 被强制隐藏`);
                    continue;
                }
                // 否则显示控件
                return true;
            }
        }
        return false;
    }

    // 创建上传组件
    createUploadComponent(container, type, label, nodeId) {
        const uploadItem = document.createElement('div');
        uploadItem.className = 'upload-item';
        uploadItem.innerHTML = `
            <div class="upload-header">
                <span class="upload-label">${label}</span>
                <div class="file-input-wrapper">
                    <input type="file" class="file-input" accept="${this.getAcceptType(type)}" data-type="${type}" data-node-id="${nodeId}">
                    <button class="file-input-btn">
                        <i class="fas fa-upload"></i>
                        选择文件
                    </button>
                </div>
            </div>
            <div class="upload-preview" style="display: none;"></div>
            <div class="upload-status" style="display: none;"></div>
        `;
        container.appendChild(uploadItem);
    }

    // 更新上传组显示/隐藏
    updateUploadGroupVisibility() {
        const uploadGroup = document.getElementById('upload-group');
        const imageUploads = document.getElementById('image-uploads');
        const videoUploads = document.getElementById('video-uploads');
        const audioUploads = document.getElementById('audio-uploads');
        
        const hasUploads = 
            imageUploads.children.length > 0 ||
            videoUploads.children.length > 0 ||
            audioUploads.children.length > 0;
        
        if (hasUploads) {
            uploadGroup.style.display = 'block';
        } else {
            uploadGroup.style.display = 'none';
        }
    }

    // 获取文件类型
    getAcceptType(type) {
        switch (type) {
            case 'image': return 'image/*';
            case 'video': return 'video/*';
            case 'audio': return 'audio/*';
            default: return '*/*';
        }
    }

    // 处理文件上传
    async handleFileUpload(event) {
        const file = event.target.files[0];
        if (!file) return;
        
        const type = event.target.dataset.type;
        const nodeId = event.target.dataset.nodeId;
        const uploadItem = event.target.closest('.upload-item');
        const preview = uploadItem.querySelector('.upload-preview');
        const status = uploadItem.querySelector('.upload-status');
        
        try {
            // 显示预览
            this.showFilePreview(preview, file, type);
            
            // 上传文件
            const filename = await this.uploadFile(file);
            
            // 更新工作流
            this.updateWorkflowFile(nodeId, filename, type);
            
            // 显示成功状态
            status.textContent = '上传成功！';
            status.style.display = 'block';
            status.style.color = 'var(--success-color)';
            
        } catch (error) {
            console.error('文件上传失败:', error);
            status.textContent = '上传失败: ' + error.message;
            status.style.display = 'block';
            status.style.color = 'var(--error-color)';
        }
    }

    // 显示文件预览
    showFilePreview(preview, file, type) {
        const url = URL.createObjectURL(file);
        preview.style.display = 'block';
        
        if (type === 'image') {
            preview.innerHTML = `<img src="${url}" alt="预览">`;
        } else if (type === 'video') {
            preview.innerHTML = `<video src="${url}" controls></video>`;
        } else if (type === 'audio') {
            preview.innerHTML = `<audio src="${url}" controls></audio>`;
        }
    }

    // 上传文件到ComfyUI
    async uploadFile(file) {
        const formData = new FormData();
        formData.append('image', file); // ComfyUI统一使用'image'字段名
        
        try {
            const response = await fetch(`${this.comfyUIUrl}/upload/image`, {
                method: 'POST',
                body: formData
            });
            
            if (!response.ok) {
                throw new Error(`上传失败: ${response.statusText}`);
            }
            
            const result = await response.json();
            return result.name || file.name;
        } catch (error) {
            // 如果当前服务器地址失败，尝试回退到本地地址
            if (this.comfyUIUrl !== `${window.location.protocol}//${window.location.host}`) {
                console.warn('🔄 服务器连接失败，尝试回退到本地地址:', error.message);
                const localUrl = `${window.location.protocol}//${window.location.host}`;
                
                try {
                    const response = await fetch(`${localUrl}/upload/image`, {
                        method: 'POST',
                        body: formData
                    });
                    
                    if (response.ok) {
                        // 回退成功，更新服务器地址
                        this.updateServerUrl(window.location.host);
                        if (typeof showNotification === 'function') {
                            showNotification('服务器地址不可达，已自动切换到本地地址', 'warning');
                        }
                        const result = await response.json();
                        return result.name || file.name;
                    }
                } catch (fallbackError) {
                    console.error('本地服务器也无法连接:', fallbackError);
                }
            }
            
            // 抛出原始错误
            throw error;
        }
    }

    // 更新工作流中的文件名
    updateWorkflowFile(nodeId, filename, type) {
        if (!this.currentWorkflow || !this.currentWorkflow[nodeId]) return;
        
        const node = this.currentWorkflow[nodeId];
        
        switch (type) {
            case 'image':
                if (node.inputs) node.inputs.image = filename;
                break;
            case 'video':
                if (node.inputs) node.inputs.file = filename;
                break;
            case 'audio':
                if (node.inputs) node.inputs.audio = filename;
                break;
        }
    }

    // 更新工作流中的提示词
    updatePromptInWorkflow(type, value) {
        if (!this.currentWorkflow) return;
        
        // 检测并处理提示词冲突
        const conflictResolved = this.resolvePromptConflicts(type, value);
        if (conflictResolved) {
            console.log(`✅ 提示词冲突已解决: ${type} 提示词已更新，冲突的反面提示词已清空`);
        }
        
        const nodeId = this.findPromptNodeId(this.currentWorkflow, type);
        if (nodeId) {
            const node = this.currentWorkflow[nodeId];
            if (node.inputs) {
                if (node.inputs.text !== undefined) {
                    node.inputs.text = value;
                } else if (type === 'positive' && node.inputs.positive !== undefined) {
                    node.inputs.positive = value;
                } else if (type === 'negative' && node.inputs.negative !== undefined) {
                    node.inputs.negative = value;
                }
            }
        }
    }

    // 检测并解决提示词冲突
    resolvePromptConflicts(type, value) {
        if (!this.currentWorkflow || !value.trim()) return false;
        
        // 获取当前类型和对方类型的节点信息
        const currentNodeInfo = this.getPromptNodeInfo(this.currentWorkflow, type);
        const oppositeType = type === 'positive' ? 'negative' : 'positive';
        const oppositeNodeInfo = this.getPromptNodeInfo(this.currentWorkflow, oppositeType);
        
        if (!currentNodeInfo || !oppositeNodeInfo) return false;
        
        // 检查是否存在节点冲突（同一个text节点被两种类型共用）
        const hasConflict = this.detectNodeConflict(currentNodeInfo, oppositeNodeInfo);
        
        if (hasConflict) {
            const conflictNodeId = hasConflict.nodeId;
            console.log(`⚠️ 检测到提示词冲突: 正面和反面提示词尝试使用同一节点 ${conflictNodeId} 的 text 字段`);
            console.log(`📊 冲突详情: ${hasConflict.description}`);
            
            // 如果是正面提示词更新，清空反面提示词
            if (type === 'positive') {
                return this.resolveConflictByPositive(oppositeNodeInfo, conflictNodeId);
            }
            // 如果是反面提示词更新且与正面提示词冲突，则拒绝更新
            else if (type === 'negative') {
                return this.resolveConflictByNegative();
            }
        }
        
        return false;
    }
    
    // 获取提示词节点详细信息（支持层级节点ID）
    getPromptNodeInfo(workflow, type) {
        const inputKey = type === 'positive' ? 'positive' : 'negative';
        
        console.log(`🔍 获取 ${type} 提示词节点信息...`);
        
        // 查找引用该类型提示词的节点
        for (const nodeId in workflow) {
            const node = workflow[nodeId];
            if (node.inputs && node.inputs[inputKey] !== undefined) {
                console.log(`🔎 找到引用节点 ${nodeId}, ${inputKey} = ${JSON.stringify(node.inputs[inputKey])}`);
                
                if (typeof node.inputs[inputKey] === 'string') {
                    // 直接字符串类型
                    console.log(`✅ 直接字符串类型节点: ${nodeId}`);
                    return {
                        referenceNodeId: nodeId,
                        targetNodeId: nodeId,
                        fieldType: 'direct',
                        fieldName: inputKey
                    };
                }
                if (Array.isArray(node.inputs[inputKey])) {
                    // 连接到其他节点（支持层级节点ID）
                    const connectedNodeId = node.inputs[inputKey][0];
                    console.log(`🔗 连接到节点: ${connectedNodeId}`);
                    
                    const textNodeId = this.findTextNodeId(workflow, connectedNodeId);
                    if (textNodeId) {
                        console.log(`✅ 找到目标文本节点: ${textNodeId}`);
                        return {
                            referenceNodeId: nodeId,
                            targetNodeId: textNodeId,
                            fieldType: 'connected',
                            fieldName: 'text'
                        };
                    }
                }
            }
        }
        
        // 如果是反向提示词且没有找到专门的negative字段，搜索第一个text字段
        if (type === 'negative') {
            console.log('🔍 反向提示词未找到专门字段，搜索第一个text字段...');
            for (const nodeId in workflow) {
                const node = workflow[nodeId];
                if (node.inputs && node.inputs.text !== undefined && typeof node.inputs.text === 'string') {
                    console.log(`🎯 找到第一个text字段节点: ${nodeId}，停止搜索`);
                    return {
                        referenceNodeId: nodeId,
                        targetNodeId: nodeId,
                        fieldType: 'direct',
                        fieldName: 'text'
                    };
                }
            }
        }
        
        console.log(`❌ 未找到 ${type} 提示词节点`);
        return null;
    }
    
    // 检测节点冲突
    detectNodeConflict(currentNodeInfo, oppositeNodeInfo) {
        // 检查是否指向同一个目标节点
        if (currentNodeInfo.targetNodeId === oppositeNodeInfo.targetNodeId) {
            // 进一步检查是否都使用text字段
            if (currentNodeInfo.fieldName === 'text' || oppositeNodeInfo.fieldName === 'text' ||
                (currentNodeInfo.fieldType === 'connected' && oppositeNodeInfo.fieldType === 'connected')) {
                return {
                    nodeId: currentNodeInfo.targetNodeId,
                    description: `节点 ${currentNodeInfo.targetNodeId} 被正面提示词(${currentNodeInfo.referenceNodeId})和反面提示词(${oppositeNodeInfo.referenceNodeId})同时引用`
                };
            }
        }
        
        return false;
    }
    
    // 通过正面提示词优先解决冲突
    resolveConflictByPositive(oppositeNodeInfo, conflictNodeId) {
        // 清空反面提示词的UI输入框
        const negativeInput = document.getElementById('negative-prompt');
        if (negativeInput) {
            negativeInput.value = '';
            console.log('🔄 已清空反面提示词输入框');
        }
        
        // 清空工作流中的反面提示词节点
        const oppositeNode = this.currentWorkflow[oppositeNodeInfo.targetNodeId];
        if (oppositeNode && oppositeNode.inputs) {
            if (oppositeNode.inputs.text !== undefined) {
                oppositeNode.inputs.text = '';
                console.log(`🔄 已清空节点 ${oppositeNodeInfo.targetNodeId} 的 text 字段`);
            }
        }
        
        // 如果是通过连接引用的，还需要检查引用节点
        if (oppositeNodeInfo.fieldType === 'connected') {
            const referenceNode = this.currentWorkflow[oppositeNodeInfo.referenceNodeId];
            if (referenceNode && referenceNode.inputs && referenceNode.inputs.negative !== undefined) {
                // 不直接修改连接，但可以记录日志
                console.log(`ℹ️ 反面提示词通过节点 ${oppositeNodeInfo.referenceNodeId} 连接到节点 ${oppositeNodeInfo.targetNodeId}`);
            }
        }
        
        console.log('✅ 正面提示词优先策略已执行，冲突已解决');
        return true;
    }
    
    // 通过拒绝反面提示词更新解决冲突
    resolveConflictByNegative() {
        console.log('❌ 反面提示词与正面提示词冲突，拒绝更新，保持反面提示词为空');
        
        // 清空反面提示词输入框，保持为空
        const negativeInput = document.getElementById('negative-prompt');
        if (negativeInput) {
            negativeInput.value = '';
        }
        
        console.log('🛡️ 正面提示词受到保护，反面提示词保持为空');
        return true;
    }
    
    // 查找提示词节点ID
    findPromptNodeId(workflow, type) {
        const inputKey = type === 'positive' ? 'positive' : 'negative';
        
        for (const nodeId in workflow) {
            const node = workflow[nodeId];
            if (node.inputs && node.inputs[inputKey] !== undefined) {
                if (typeof node.inputs[inputKey] === 'string') {
                    return nodeId;
                }
                if (Array.isArray(node.inputs[inputKey])) {
                    const connectedNodeId = node.inputs[inputKey][0];
                    const textNodeId = this.findTextNodeId(workflow, connectedNodeId);
                    if (textNodeId) return textNodeId;
                }
            }
        }
        
        // 如果没有找到专用的positive/negative字段，检查是否有共用的text字段
        for (const nodeId in workflow) {
            const node = workflow[nodeId];
            if (node.inputs && node.inputs.text !== undefined && typeof node.inputs.text === 'string') {
                // 检查这个节点是否被正面或反面提示词连接使用
                if (this.isNodeUsedByPromptType(workflow, nodeId, type)) {
                    return nodeId;
                }
            }
        }
        
        return null;
    }
    
    // 检查节点是否被指定类型的提示词使用
    isNodeUsedByPromptType(workflow, targetNodeId, promptType) {
        const inputKey = promptType === 'positive' ? 'positive' : 'negative';
        
        for (const nodeId in workflow) {
            const node = workflow[nodeId];
            if (node.inputs && node.inputs[inputKey] !== undefined) {
                if (Array.isArray(node.inputs[inputKey])) {
                    const connectedNodeId = node.inputs[inputKey][0];
                    if (connectedNodeId === targetNodeId) {
                        return true;
                    }
                    // 递归查找连接的节点
                    if (this.findTextNodeId(workflow, connectedNodeId) === targetNodeId) {
                        return true;
                    }
                }
            }
        }
        return false;
    }

    // 查找文本节点ID
    findTextNodeId(workflow, nodeId) {
        const node = workflow[nodeId];
        if (!node || !node.inputs) return null;
        
        if (node.inputs.text !== undefined && typeof node.inputs.text === 'string') {
            return nodeId;
        }
        
        if (node.inputs.positive !== undefined && typeof node.inputs.positive === 'string') {
            return nodeId;
        }
        
        return null;
    }

    // 生成内容
    async generateContent() {
        if (!this.currentWorkflow) {
            this.showError('请先加载工作流');
            return;
        }
        
        try {
            this.setGenerateButtonState(false);
            this.startTime = Date.now(); // 记录开始时间
            this.startElapsedTimeUpdate(); // 开始更新耗时显示
            this.updateProgress('检查连接状态...', 0);
            
            // 检查连接状态
            const isConnected = await this.checkConnectionStatus();
            if (!isConnected) {
                throw new Error('无法连接到ComfyUI服务。请确保ComfyUI正在运行并监听端口8188。');
            }
            
            this.updateProgress('准备生成...', 5);
            
            // 处理随机种子
            this.handleRandomSeed();
            
            // 提交任务
            const taskId = await this.submitTask();
            this.currentTaskId = taskId;
            
            this.updateProgress('任务已提交，等待处理...', 10);
            
            // 设置超时检查
            this.setupTaskTimeout(taskId);
            
            // 启动主动轮询检查（防止WebSocket消息丢失）
            this.startPollingForResults(taskId);
            
        } catch (error) {
            console.error('生成失败:', error);
            this.showDetailedError('生成失败', error);
            // 停止时间更新
            this.stopElapsedTimeUpdate();
            this.setGenerateButtonState(true);
        }
    }

    // 处理随机种子
    handleRandomSeed() {
        const randomSeedCheckbox = document.getElementById('random-seed');
        const seedValueDisplay = document.getElementById('seed-value-display');
        const currentSeedValue = document.getElementById('current-seed-value');
        
        if (randomSeedCheckbox && randomSeedCheckbox.checked) {
            const randomSeed = Math.floor(Math.random() * 1000000);
            let seedsUpdated = [];
            
            for (const nodeId in this.currentWorkflow) {
                const node = this.currentWorkflow[nodeId];
                if (node.inputs) {
                    // 处理普通种子 (seed)
                    if (node.inputs.seed !== undefined) {
                        node.inputs.seed = randomSeed;
                        seedsUpdated.push(`节点${nodeId}.seed`);
                    }
                    
                    // 处理噪声种子 (noise_seed)
                    if (node.inputs.noise_seed !== undefined) {
                        node.inputs.noise_seed = randomSeed;
                        seedsUpdated.push(`节点${nodeId}.noise_seed`);
                    }
                }
            }
            
            // 记录更新的种子
            if (seedsUpdated.length > 0) {
                console.log('🎲 随机种子已更新:', {
                    seed: randomSeed,
                    updatedFields: seedsUpdated
                });
            }
            
            // 显示种子数值
            if (seedValueDisplay && currentSeedValue) {
                seedValueDisplay.style.display = 'block';
                currentSeedValue.textContent = randomSeed;
            }
        } else {
            // 隐藏种子数值显示
            if (seedValueDisplay) {
                seedValueDisplay.style.display = 'none';
            }
        }
    }

    // 提交任务到ComfyUI
    async submitTask() {
        const prompt = {
            prompt: this.currentWorkflow,
            client_id: this.generateClientId()
        };
        
        try {
            const response = await fetch(`${this.comfyUIUrl}/prompt`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(prompt)
            });
            
            if (!response.ok) {
                throw new Error(`提交任务失败: ${response.statusText}`);
            }
            
            const result = await response.json();
            return result.prompt_id;
        } catch (error) {
            // 如果当前服务器地址失败，尝试回退到本地地址
            if (this.comfyUIUrl !== `${window.location.protocol}//${window.location.host}`) {
                console.warn('🔄 服务器连接失败，尝试回退到本地地址:', error.message);
                const localUrl = `${window.location.protocol}//${window.location.host}`;
                
                try {
                    const response = await fetch(`${localUrl}/prompt`, {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(prompt)
                    });
                    
                    if (response.ok) {
                        // 回退成功，更新服务器地址
                        this.updateServerUrl(window.location.host);
                        if (typeof showNotification === 'function') {
                            showNotification('服务器地址不可达，已自动切换到本地地址', 'warning');
                        }
                        const result = await response.json();
                        return result.prompt_id;
                    }
                } catch (fallbackError) {
                    console.error('本地服务器也无法连接:', fallbackError);
                }
            }
            
            // 抛出原始错误
            throw error;
        }
    }

    // 生成客户端ID
    generateClientId() {
        return 'client_' + Math.random().toString(36).substring(2, 15);
    }

    // 连接WebSocket
    connectWebSocket() {
        try {
            // 使用动态服务器地址
            const wsUrl = this.comfyUIUrl.replace(/^http/, 'ws') + '/ws';
            console.log('连接WebSocket:', wsUrl);
            
            this.websocket = new WebSocket(wsUrl);
            
            this.websocket.onopen = () => {
                console.log('WebSocket连接已建立');
                this.updateConnectionStatus(true);
                this.reconnectAttempts = 0; // 重置重连计数器
                this.wsFailbackAttempted = false; // 重置回退标记
            };
            
            this.websocket.onmessage = (event) => {
                try {
                    this.handleWebSocketMessage(JSON.parse(event.data));
                } catch (error) {
                    console.error('WebSocket消息解析失败:', error);
                }
            };
            
            this.websocket.onclose = (event) => {
                console.log('WebSocket连接已关闭', event.code, event.reason);
                this.updateConnectionStatus(false);
                
                // 智能重连
                this.attemptReconnect();
            };
            
            this.websocket.onerror = (error) => {
                console.error('WebSocket错误:', error);
                this.updateConnectionStatus(false);
                
                // 如果当前不是本地地址且未尝试过回退，则尝试回退到本地地址
                if (this.comfyUIUrl !== 'http://127.0.0.1:8188' && !this.wsFailbackAttempted) {
                    this.wsFailbackAttempted = true;
                    console.warn('WebSocket连接失败，尝试回退到本地地址');
                    this.updateServerUrl('127.0.0.1:8188');
                    this.showSuccessNotification('WebSocket连接失败，已自动切换到本地服务器地址');
                    // 延迟一点再重连，让服务器地址更新生效
                    setTimeout(() => {
                        this.connectWebSocket();
                    }, 1000);
                    return;
                }
            };
            
        } catch (error) {
            console.error('WebSocket连接失败:', error);
            this.updateConnectionStatus(false);
            
            // 如果当前不是本地地址且未尝试过回退，则尝试回退到本地地址
            if (this.comfyUIUrl !== 'http://127.0.0.1:8188' && !this.wsFailbackAttempted) {
                this.wsFailbackAttempted = true;
                console.warn('WebSocket连接失败，尝试回退到本地地址');
                this.updateServerUrl('127.0.0.1:8188');
                this.showSuccessNotification('WebSocket连接失败，已自动切换到本地服务器地址');
                // 延迟一点再重连，让服务器地址更新生效
                setTimeout(() => {
                    this.connectWebSocket();
                }, 1000);
                return;
            }
            
            this.attemptReconnect();
        }
    }
    
    // 尝试重连
    attemptReconnect() {
        if (!this.reconnectAttempts) this.reconnectAttempts = 0;
        
        if (this.reconnectAttempts < 5) { // 最多尝试5次重连
            this.reconnectAttempts++;
            const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts - 1), 10000); // 指数退避，最多10秒
            
            console.log(`将在 ${delay}ms 后尝试第 ${this.reconnectAttempts} 次重连...`);
            
            setTimeout(() => {
                if (this.websocket.readyState === WebSocket.CLOSED) {
                    this.connectWebSocket();
                }
            }, delay);
        } else {
            console.error('WebSocket重连失败，请手动刷新页面');
            if (this.currentTaskId) {
                this.showDetailedError('WebSocket连接失败', new Error('无法连接到ComfyUI WebSocket服务，请检查服务器状态并刷新页面'));
                this.setGenerateButtonState(true);
                this.currentTaskId = null;
            }
        }
    }

    // 处理WebSocket消息
    handleWebSocketMessage(data) {
        console.log('WebSocket消息:', data); // 添加调试日志
        
        // 处理进度消息 - 放宽条件，允许没有prompt_id的进度消息
        if (data.type === 'progress' && data.data) {
            // 如果有当前任务ID，检查是否匹配；如果没有当前任务ID或消息没有prompt_id，也处理
            const shouldProcess = !this.currentTaskId || !data.data.prompt_id || data.data.prompt_id === this.currentTaskId;
            
            if (shouldProcess && data.data.value !== undefined && data.data.max !== undefined) {
                // 计算实际进度，范围从20%到90%（为开始和结束阶段留出空间）
                const baseProgress = Math.round((data.data.value / data.data.max) * 70) + 20;
                const progressText = window.languageManager ? 
                    `${window.languageManager.t('interface.processing')} (${data.data.value}/${data.data.max})` :
                    `正在处理 (${data.data.value}/${data.data.max})`;
                this.updateProgress(progressText, baseProgress);
                console.log(`进度更新: ${data.data.value}/${data.data.max} = ${baseProgress}%`);
            }
        } else if (data.type === 'executed' && data.data && data.data.prompt_id === this.currentTaskId) {
            console.log('任务执行完成:', data.data.prompt_id);
            this.updateProgress('处理完成，获取结果...', 90);
            this.handleTaskCompleted(data.data.prompt_id);
        } else if (data.type === 'executing' && data.data) {
            // 处理正在执行的消息 - 也放宽条件
            const shouldProcess = !this.currentTaskId || !data.data.prompt_id || data.data.prompt_id === this.currentTaskId;
            
            if (shouldProcess && data.data.node) {
                const nodeTitle = this.getNodeTitle(data.data.node);
                const executingText = window.languageManager ? window.languageManager.t('interface.executing') : '正在执行:';
                const executingNodeText = window.languageManager ? window.languageManager.t('interface.executingNode') : '正在执行节点:';
                const progressText = nodeTitle ? `${executingText} ${nodeTitle}` : `${executingNodeText} ${data.data.node}`;
                // 执行阶段设置为15-25%之间的随机值，避免卡在固定值
                const executingProgress = 15 + Math.floor(Math.random() * 10);
                this.updateProgress(progressText, executingProgress);
                console.log(`执行节点: ${data.data.node} = ${executingProgress}%`);
            }
        } else if (data.type === 'execution_cached' && data.data && data.data.prompt_id === this.currentTaskId) {
            // 处理缓存执行的消息
            const cachedText = window.languageManager ? window.languageManager.t('interface.usingCachedResult') : '使用缓存结果';
            this.updateProgress(cachedText, 85);
        }
        
        // 添加更多的消息类型处理 - 放宽条件
        if (data.data) {
            const shouldProcess = !this.currentTaskId || !data.data.prompt_id || data.data.prompt_id === this.currentTaskId;
            
            if (shouldProcess) {
                switch (data.type) {
                    case 'execution_start':
                        const startText = window.languageManager ? window.languageManager.t('interface.startExecutingWorkflow') : '开始执行工作流';
                        this.updateProgress(startText, 20);
                        console.log('工作流开始执行');
                        break;
                    case 'execution_success':
                        console.log('执行成功，开始获取结果');
                        this.handleTaskCompleted(data.data.prompt_id);
                        break;
                    case 'execution_error':
                        console.error('执行错误:', data.data);
                        this.showDetailedError('执行错误', new Error(data.data.error || '工作流执行失败'));
                        this.setGenerateButtonState(true);
                        this.currentTaskId = null;
                        break;
                }
            }
        }
        
        // 记录所有未处理的消息类型，帮助调试
        if (!['progress', 'executed', 'executing', 'execution_cached', 'execution_start', 'execution_success', 'execution_error'].includes(data.type)) {
            console.log('未处理的WebSocket消息类型:', data.type, data);
        }
    }

    // 处理任务完成
    async handleTaskCompleted(promptId) {
        try {
            // 清除所有定时器
            this.clearTaskTimeout();
            this.clearPolling();
            this.clearQueueStatusCheck();
            
            const gettingResultsText = window.languageManager ? window.languageManager.t('interface.gettingResults') : '获取结果...';
            this.updateProgress(gettingResultsText, 95);
            
            // 获取历史记录
            const history = await this.getHistory(promptId);
            const results = this.extractResults(history);
            
            if (results.length > 0) {
                this.displayResults(results);
                this.addToHistory(results);
                const completeText = window.languageManager ? window.languageManager.t('interface.completed') : '完成';
                this.updateProgress(completeText, 100);
            } else {
                console.warn('未找到生成结果，但任务已完成');
                const taskCompletedText = window.languageManager ? window.languageManager.t('interface.taskCompleted') : '任务完成，但未找到结果';
                this.updateProgress(taskCompletedText, 100);
            }
            
            // 停止时间更新
            this.stopElapsedTimeUpdate();
            
            // 重置进度条颜色
            const progressFill = document.getElementById('progress-fill');
            if (progressFill) {
                progressFill.style.background = 'var(--primary-color)';
            }
            
        } catch (error) {
            console.error('获取结果失败:', error);
            this.showDetailedError('获取结果失败', error);
        } finally {
            // 停止时间更新
            this.stopElapsedTimeUpdate();
            this.setGenerateButtonState(true);
            this.currentTaskId = null;
        }
    }

    // 获取历史记录
    async getHistory(promptId) {
        try {
            const response = await fetch(`${this.comfyUIUrl}/history/${promptId}`);
            
            if (!response.ok) {
                throw new Error(`获取历史记录失败: ${response.statusText}`);
            }
            
            return await response.json();
        } catch (error) {
            // 如果当前服务器地址失败，尝试回退到本地地址
            if (this.comfyUIUrl !== 'http://127.0.0.1:8188') {
                console.warn('获取历史记录失败，尝试回退到本地地址:', error.message);
                try {
                    const fallbackResponse = await fetch(`http://127.0.0.1:8188/history/${promptId}`);
                    
                    if (fallbackResponse.ok) {
                        // 回退成功，更新服务器地址
                        this.updateServerUrl('127.0.0.1:8188');
                        this.showSuccessNotification('已自动切换到本地服务器地址');
                        return await fallbackResponse.json();
                    }
                } catch (fallbackError) {
                    console.error('回退到本地地址也失败:', fallbackError);
                }
            }
            throw error;
        }
    }

    // 提取结果
    extractResults(history) {
        const results = [];
        console.log('📊 历史记录原始数据:', history);
        
        for (const promptId in history) {
            const prompt = history[promptId];
            console.log(`📋 处理prompt ${promptId}:`, prompt);
            
            if (prompt.outputs) {
                for (const nodeId in prompt.outputs) {
                    const output = prompt.outputs[nodeId];
                    console.log(`🔍 节点 ${nodeId} 输出:`, output);
                    
                    // 检查节点类型
                    const nodeInfo = this.currentWorkflow && this.currentWorkflow[nodeId] ? this.currentWorkflow[nodeId] : null;
                    if (nodeInfo) {
                        console.log(`🏷️ 节点 ${nodeId} 类型: ${nodeInfo.class_type}`);
                    }
                    
                    // 处理图像
                    if (output.images && Array.isArray(output.images)) {
                        output.images.forEach(image => {
                            const result = {
                                type: 'image',
                                url: `${this.comfyUIUrl}/api/view?filename=${encodeURIComponent(image.filename)}&type=${encodeURIComponent(image.type || 'output')}&subfolder=${encodeURIComponent(image.subfolder || '')}`,
                                filename: image.filename
                            };
                            results.push(result);
                            console.log('添加图像结果:', result);
                        });
                    }
                    
                    // 处理视频（多种可能的字段名）
                    const videoFields = ['videos', 'gifs', 'video'];
                    videoFields.forEach(field => {
                        if (output[field] && Array.isArray(output[field])) {
                            output[field].forEach(video => {
                                // 确保视频文件的subfolder默认为'video'
                                const subfolder = video.subfolder || 'video';
                                // 使用标准格式：/api/view?filename=xxx&type=output&subfolder=video
                                const videoUrl = `${this.comfyUIUrl}/api/view?filename=${encodeURIComponent(video.filename)}&type=output&subfolder=${encodeURIComponent(subfolder)}`;
                                const result = {
                                    type: 'video',
                                    url: videoUrl,
                                    filename: video.filename
                                };
                                results.push(result);
                                console.log('添加视频结果:', result);
                                console.log('📍 视频URL格式:', videoUrl);
                            });
                        }
                    });
                    
                    // 特殊处理SaveVideo节点的输出
                    if (this.currentWorkflow && this.currentWorkflow[nodeId] && this.currentWorkflow[nodeId].class_type === 'SaveVideo') {
                        console.log(`检测到SaveVideo节点 ${nodeId}，输出:`, output);
                        
                        // SaveVideo可能使用不同的字段名
                        const saveVideoFields = ['output', 'saved', 'file', 'result'];
                        saveVideoFields.forEach(field => {
                            if (output[field] && Array.isArray(output[field])) {
                                output[field].forEach(item => {
                                    if (item.filename && item.filename.toLowerCase().endsWith('.mp4')) {
                                        // 使用标准格式：/api/view?filename=xxx&type=output&subfolder=video
                                        const videoUrl = `${this.comfyUIUrl}/api/view?filename=${encodeURIComponent(item.filename)}&type=output&subfolder=video`;
                                        const result = {
                                            type: 'video',
                                            url: videoUrl,
                                            filename: item.filename
                                        };
                                        // 检查是否已经添加过
                                        const exists = results.some(r => r.filename === item.filename);
                                        if (!exists) {
                                            results.push(result);
                                            console.log('添加SaveVideo视频结果:', result);
                                            console.log('📍 SaveVideo URL格式:', videoUrl);
                                        }
                                    }
                                });
                            }
                        });
                    }
                    
                    // 处理音频（多种可能的字段名）
                    const audioFields = ['audios', 'audio'];
                    audioFields.forEach(field => {
                        if (output[field] && Array.isArray(output[field])) {
                            output[field].forEach(audio => {
                                // 确保音频文件的subfolder默认为'audio'
                                const subfolder = audio.subfolder || 'audio';
                                const result = {
                                    type: 'audio',
                                    url: `${this.comfyUIUrl}/api/view?filename=${encodeURIComponent(audio.filename)}&type=${encodeURIComponent(audio.type || 'output')}&subfolder=${encodeURIComponent(subfolder)}`,
                                    filename: audio.filename
                                };
                                results.push(result);
                                console.log('添加音频结果:', result);
                            });
                        }
                    });
                    
                    // 通用处理：根据文件扩展名推断类型
                    for (const key in output) {
                        if (Array.isArray(output[key])) {
                            console.log(`📁 检查字段 ${key}:`, output[key]);
                            output[key].forEach(item => {
                                if (item.filename) {
                                    const ext = item.filename.toLowerCase().split('.').pop();
                                    let type = 'file';
                                    
                                    console.log(`📄 文件: ${item.filename}, 扩展名: ${ext}`);
                                    
                                    if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'].includes(ext)) {
                                        type = 'image';
                                    } else if (['mp4', 'avi', 'mov', 'webm', 'mkv', 'flv', '3gp', 'wmv', 'm4v', 'ogv', 'mts', 'ts', 'vob', 'asf', 'rm', 'rmvb', 'divx', 'xvid', 'f4v', 'm2ts', 'mpg', 'mpeg', 'qt'].includes(ext)) {
                                        type = 'video';
                                        console.log(`🎥 识别为视频文件: ${item.filename}`);
                                    } else if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'opus'].includes(ext)) {
                                        type = 'audio';
                                    }
                                    
                                    // 检查是否已经添加过
                                    const exists = results.some(r => r.filename === item.filename);
                                    if (!exists) {
                                        // 根据文件类型设置默认subfolder
                                        let subfolder = item.subfolder || '';
                                        if (type === 'video' && !subfolder) {
                                            subfolder = 'video'; // 默认视频文件在video目录
                                        } else if (type === 'audio' && !subfolder) {
                                            subfolder = 'audio'; // 默认音频文件在audio目录
                                        }
                                        
                                        // 使用标准格式构建URL
                                        const fileUrl = `${this.comfyUIUrl}/api/view?filename=${encodeURIComponent(item.filename)}&type=output&subfolder=${encodeURIComponent(subfolder)}`;
                                        
                                        const result = {
                                            type: type,
                                            url: fileUrl,
                                            filename: item.filename
                                        };
                                        results.push(result);
                                        console.log(`✅ 添加${type}结果（通用）:`, result);
                                        if (type === 'video') {
                                            console.log('📍 通用视频URL格式:', fileUrl);
                                        }
                                    } else {
                                        console.log(`⚠️ 文件已存在，跳过: ${item.filename}`);
                                    }
                                }
                            });
                        }
                    }
                }
            }
        }
        
        console.log('🎥 最终结果列表:', results);
        
        // 测试MP4文件URL的访问性
        results.forEach(async (result, index) => {
            if (result.type === 'video' && result.filename.toLowerCase().endsWith('.mp4')) {
                console.log(`📀 测试MP4文件URL: ${result.url}`);
                try {
                    const response = await fetch(result.url, { method: 'HEAD' });
                    console.log(`✅ MP4文件 ${result.filename} 访问状态: ${response.status}`);
                    if (!response.ok) {
                        console.error(`❌ MP4文件访问失败: ${response.status} - ${response.statusText}`);
                    }
                } catch (error) {
                    console.error(`❌ MP4文件网络错误:`, error);
                }
            }
        });
        
        return results;
    }

    // 显示结果
    displayResults(results) {
        console.log('显示结果:', results);
        
        if (results.length === 0) {
            console.log('没有生成结果');
            return;
        }
        
        // 统一显示所有结果到居中容器
        this.displayUnifiedResults(results);
        
        // 隐藏状态提示
        const resultStatus = document.getElementById('result-status');
        if (resultStatus) {
            resultStatus.style.display = 'none';
        }
        
    }
    
    // 统一显示所有结果
    displayUnifiedResults(results) {
        const container = document.getElementById('unified-results');
        if (!container) {
            console.warn('Unified results container not found');
            return;
        }
        
        container.innerHTML = '';
        
        if (results.length === 0) {
            container.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 40px;">暂无生成结果</p>';
            return;
        }
        
        results.forEach((result, index) => {
            const mediaItem = this.createMediaElement(result, index);
            container.appendChild(mediaItem);
        });
        
        console.log(`✅ 统一显示 ${results.length} 个结果`);
    }
    
    // 在网格中显示媒体（保留兼容性）
    displayMediaInGrid(items, gridId, sectionId, countId) {
        const grid = document.getElementById(gridId);
        const section = document.getElementById(sectionId);
        const count = document.getElementById(countId);
        
        if (!grid || !section || !count) {
            console.warn(`Media display elements not found: ${gridId}, ${sectionId}, ${countId}`);
            return;
        }
        
        if (items.length === 0) {
            section.style.display = 'none';
            return;
        }
        
        section.style.display = 'block';
        count.textContent = items.length;
        grid.innerHTML = '';
        
        items.forEach((item, index) => {
            const mediaItem = this.createMediaElement(item, index);
            grid.appendChild(mediaItem);
        });
    }
    
    // 创建媒体元素
    createMediaElement(result, index) {
        const mediaItem = document.createElement('div');
        mediaItem.className = 'media-item';
        
        // 调试信息：输出结果类型和文件名
        console.log(`🔍 创建媒体元素 - 文件: ${result.filename}, 类型: ${result.type}, URL: ${result.url}`);
        
        // 强制检查文件类型，确保视频文件被正确识别
        if (result.filename) {
            const ext = result.filename.toLowerCase().split('.').pop();
            if (['mp4', 'avi', 'mov', 'webm', 'mkv', 'flv', '3gp', 'wmv', 'm4v', 'ogv', 'mts', 'ts', 'vob', 'asf', 'rm', 'rmvb', 'divx', 'xvid', 'f4v', 'm2ts', 'mpg', 'mpeg', 'qt'].includes(ext)) {
                if (result.type !== 'video') {
                    console.log(`🔧 强制修正文件类型: ${result.filename} ${result.type} -> video`);
                    result.type = 'video';
                }
            }
        }
        
        if (result.type === 'image') {
            mediaItem.innerHTML = `
                <img src="${result.url}" alt="生成结果 ${index + 1}" 
                     style="width: 100%; height: auto; border-radius: 8px; cursor: pointer;"
                     onclick="openFilePreview('${result.url}', 'image', '${result.filename}')"
                     onerror="console.error('图像加载失败:', '${result.url}'); this.style.display='none';">
                <p style="margin-top: 8px; font-size: 0.875rem; color: var(--text-secondary); text-align: center;">${result.filename}</p>
            `;
        } else if (result.type === 'video') {
            mediaItem.innerHTML = `
                <video controls preload="metadata" loop muted autoplay
                       style="width: 100%; height: auto; border-radius: 8px;"
                       onclick="openFilePreview('${result.url}', 'video', '${result.filename}')">
                    <source src="${result.url}" type="video/mp4">
                    <source src="${result.url}" type="video/webm">
                    您的浏览器不支持视频播放。
                </video>
                <p style="margin-top: 8px; font-size: 0.875rem; color: var(--text-secondary); text-align: center;">🎥 ${result.filename}</p>
            `;
            console.log('✅ 创建视频元素:', result.filename, '- 支持自动循环播放');
        } else if (result.type === 'audio') {
            mediaItem.innerHTML = `
                <audio controls style="width: 100%;">
                    <source src="${result.url}" type="audio/mpeg">
                    <source src="${result.url}" type="audio/wav">
                    <source src="${result.url}" type="audio/ogg">
                    您的浏览器不支持音频播放。
                </audio>
                <p style="margin-top: 8px; font-size: 0.875rem; color: var(--text-secondary); text-align: center;">${result.filename}</p>
            `;
        } else {
            mediaItem.innerHTML = `
                <div style="padding: 20px; background: var(--input-bg); border-radius: 8px; text-align: center;">
                    <i class="fas fa-file" style="font-size: 2rem; color: var(--primary-color); margin-bottom: 8px;"></i><br>
                    <a href="${result.url}" target="_blank" style="color: var(--primary-color); text-decoration: none;">
                        ${result.filename}
                    </a>
                </div>
            `;
        }
        
        return mediaItem;
    }
    
    // 保留原有的显示逻辑作为备用
    displayResultsLegacy(results) {
        const resultSection = document.getElementById('result-section');
        const previewContainer = document.getElementById('preview-container');
        
        console.log('显示结果:', results);
        
        if (!resultSection) {
            console.warn('Result section element not found');
            return;
        }
        
        resultSection.innerHTML = '';
        
        if (results.length === 0) {
            resultSection.innerHTML = '<p style="text-align: center; color: var(--text-secondary); padding: 20px;">没有生成结果</p>';
            return;
        }
        
        // 在预览区域显示第一个结果
        if (results[0] && previewContainer) {
            this.displayInPreview(previewContainer, results[0]);
        } else if (results[0] && !previewContainer) {
            console.warn('Preview container element not found');
        }
        
        // 在结果区域显示所有结果
        results.forEach((result, index) => {
            const resultItem = document.createElement('div');
            resultItem.className = 'result-item';
            resultItem.style.marginBottom = '16px';
            
            console.log(`显示结果 ${index + 1}:`, result);
            
            if (result.type === 'image') {
                resultItem.innerHTML = `
                    <img src="${result.url}" alt="生成结果 ${index + 1}" 
                         style="max-width: 250px; height: auto; border-radius: 8px; cursor: pointer; display: block; margin: 0 auto;"
                         onclick="openFilePreview('${result.url}', 'image', '${result.filename}')"
                         onerror="console.error('图像加载失败:', '${result.url}'); this.style.display='none';">
                    <p style="margin-top: 8px; font-size: 0.875rem; color: var(--text-secondary); text-align: center;">🖼️ ${result.filename}</p>
                `;
            } else if (result.type === 'video') {
                // 创建增强的视频元素
                const videoContainer = document.createElement('div');
                videoContainer.style.cssText = 'position: relative; width: 100%; text-align: center;';
                
                const videoElement = document.createElement('video');
                videoElement.controls = true;
                videoElement.preload = 'metadata';
                videoElement.style.cssText = 'max-width: 100%; height: auto; border-radius: 8px; display: block; margin: 0 auto;';
                
                // 根据文件扩展名智能映射MIME类型
                const getVideoMimeType = (filename) => {
                    const ext = filename.toLowerCase().split('.').pop();
                    const mimeMap = {
                        'mp4': 'video/mp4',
                        'm4v': 'video/mp4',
                        'webm': 'video/webm',
                        'ogv': 'video/ogg',
                        'ogg': 'video/ogg',
                        'avi': 'video/avi',
                        'mov': 'video/quicktime',
                        'qt': 'video/quicktime',
                        'wmv': 'video/x-ms-wmv',
                        'flv': 'video/x-flv',
                        'mkv': 'video/x-matroska',
                        '3gp': 'video/3gpp',
                        'ts': 'video/mp2t',
                        'mts': 'video/mp2t',
                        'm2ts': 'video/mp2t'
                    };
                    return mimeMap[ext] || 'video/mp4';
                };
                
                // 添加多个source元素，优先使用正确的MIME类型
                const primaryMimeType = getVideoMimeType(result.filename || '');
                const sources = [
                    { src: result.url, type: primaryMimeType }, // 优先使用正确的MIME类型
                    { src: result.url, type: 'video/mp4' },
                    { src: result.url, type: 'video/webm' },
                    { src: result.url, type: 'video/avi' },
                    { src: result.url, type: 'video/quicktime' },
                    { src: result.url, type: 'video/ogg' }
                ].filter((source, index, arr) => 
                    // 去重，避免重复的source元素
                    arr.findIndex(s => s.type === source.type) === index
                );
                
                sources.forEach(source => {
                    const sourceElement = document.createElement('source');
                    sourceElement.src = source.src;
                    sourceElement.type = source.type;
                    videoElement.appendChild(sourceElement);
                });
                
                // 错误处理
                videoElement.onerror = function(e) {
                    console.error('结果视频加载失败:', e);
                    videoContainer.innerHTML = `
                        <div style="padding: 20px; text-align: center; border: 2px dashed var(--border-color); border-radius: 8px;">
                            <i class="fas fa-exclamation-triangle" style="font-size: 2rem; color: var(--error-color); margin-bottom: 12px;"></i>
                            <p style="color: var(--error-color); margin: 8px 0;">视频加载失败</p>
                            <p style="color: var(--text-secondary); font-size: 0.875rem; margin-bottom: 12px;">无法播放视频文件</p>
                            <a href="${result.url}" target="_blank" style="color: var(--primary-color); text-decoration: none;">
                                <i class="fas fa-download"></i> 下载视频文件
                            </a>
                        </div>
                    `;
                };
                
                // 成功加载事件
                videoElement.onloadedmetadata = function() {
                    console.log(`结果视频加载成功: ${result.filename}`);
                };
                
                // 为视频元素添加点击事件（在未播放时）
                videoElement.addEventListener('click', function(e) {
                    if (videoElement.paused) {
                        e.stopPropagation();
                        openFilePreview(result.url, 'video', result.filename);
                    }
                });
                
                videoContainer.appendChild(videoElement);
                
                // 添加文件名显示
                const filenameP = document.createElement('p');
                filenameP.style.cssText = 'margin-top: 8px; font-size: 0.875rem; color: var(--text-secondary); text-align: center;';
                filenameP.innerHTML = `🎥 ${result.filename}`;
                videoContainer.appendChild(filenameP);
                
                resultItem.appendChild(videoContainer);
            } else if (result.type === 'audio') {
                resultItem.innerHTML = `
                    <audio controls style="width: 100%; margin-bottom: 8px;"
                           onerror="console.error('音频加载失败:', '${result.url}'); this.style.display='none';">
                        <source src="${result.url}" type="audio/mpeg">
                        <source src="${result.url}" type="audio/wav">
                        <source src="${result.url}" type="audio/ogg">
                        您的浏览器不支持音频播放。
                    </audio>
                    <p style="margin-top: 8px; font-size: 0.875rem; color: var(--text-secondary); text-align: center;">🎵 ${result.filename}</p>
                `;
            } else {
                // 通用文件显示
                resultItem.innerHTML = `
                    <div style="padding: 20px; background: var(--input-bg); border-radius: 8px; text-align: center;">
                        <i class="fas fa-file" style="font-size: 2rem; color: var(--primary-color); margin-bottom: 8px;"></i><br>
                        <a href="${result.url}" target="_blank" style="color: var(--primary-color); text-decoration: none;">
                            ${result.filename}
                        </a>
                    </div>
                `;
            }
            
            resultSection.appendChild(resultItem);
        });
        
        console.log(`共显示 ${results.length} 个结果`);
    }

    // 在预览区域显示
    displayInPreview(container, result) {
        console.log('🎬 在预览区域显示视频:', result);
        
        if (result.type === 'image') {
            container.innerHTML = `<img src="${result.url}" alt="预览" 
                style="max-width: 250px; max-height: 250px; object-fit: contain; border-radius: 8px; display: block; margin: 0 auto; cursor: pointer;"
                onclick="openFilePreview('${result.url}', 'image', '${result.filename}')"
                onerror="console.error('预览图像加载失败:', '${result.url}');">`;
        } else if (result.type === 'video') {
            // 增强的视频显示实现
            console.log('🎥 开始创建视频元素:', {
                url: result.url,
                filename: result.filename,
                type: result.type
            });
            
            // 立即测试视频URL的可访问性
            fetch(result.url, { method: 'HEAD' })
                .then(response => {
                    console.log(`📋 视频URL状态: ${response.status} - ${response.statusText}`);
                    const contentType = response.headers.get('content-type');
                    console.log(`📄 Content-Type: ${contentType}`);
                    if (!response.ok) {
                        console.error(`❌ URL访问失败: ${response.status}`);
                    }
                })
                .catch(error => {
                    console.error('❌ 视频URL网络错误:', error);
                });
            
            const videoElement = document.createElement('video');
            videoElement.controls = true;
            videoElement.preload = 'metadata';
            videoElement.muted = true; // 添加静音属性避免自动播放限制
            videoElement.style.cssText = 'max-width: 100%; max-height: 100%; border-radius: 8px; display: block; margin: 0 auto; background: #000;';
            
            // 根据文件扩展名智能映射MIME类型
            const getVideoMimeType = (filename) => {
                const ext = filename.toLowerCase().split('.').pop();
                const mimeMap = {
                    'mp4': 'video/mp4',
                    'm4v': 'video/mp4',
                    'webm': 'video/webm',
                    'ogv': 'video/ogg',
                    'ogg': 'video/ogg',
                    'avi': 'video/avi',
                    'mov': 'video/quicktime',
                    'qt': 'video/quicktime',
                    'wmv': 'video/x-ms-wmv',
                    'flv': 'video/x-flv',
                    'mkv': 'video/x-matroska',
                    '3gp': 'video/3gpp',
                    'ts': 'video/mp2t',
                    'mts': 'video/mp2t',
                    'm2ts': 'video/mp2t'
                };
                return mimeMap[ext] || 'video/mp4';
            };
            
            // 添加多个source元素以支持不同格式
            const primaryMimeType = getVideoMimeType(result.filename || '');
            console.log(`🎞️ 检测到MIME类型: ${primaryMimeType}`);
            
            // 简化source元素，优先添加主要类型
            const sourceElement = document.createElement('source');
            sourceElement.src = result.url;
            sourceElement.type = primaryMimeType;
            videoElement.appendChild(sourceElement);
            console.log(`✅ 添加主要source: ${primaryMimeType}`);
            
            // 添加备用MP4 source
            if (primaryMimeType !== 'video/mp4') {
                const mp4Source = document.createElement('source');
                mp4Source.src = result.url;
                mp4Source.type = 'video/mp4';
                videoElement.appendChild(mp4Source);
                console.log('✅ 添加备用MP4 source');
            }
            
            // 增强的错误处理
            videoElement.onerror = (e) => {
                const error = e.target.error;
                console.error('❌ 视频加载失败详情:', {
                    url: result.url,
                    filename: result.filename,
                    errorCode: error ? error.code : 'N/A',
                    errorMessage: error ? error.message : '未知错误',
                    networkState: videoElement.networkState,
                    readyState: videoElement.readyState,
                    userAgent: navigator.userAgent
                });
                
                console.log('🔍 调试信息:', {
                    'URL': result.url,
                    '文件名': result.filename,
                    '用户代理': navigator.userAgent.substring(0, 100) + '...',
                    '网络状态': {
                        0: 'NETWORK_EMPTY',
                        1: 'NETWORK_IDLE', 
                        2: 'NETWORK_LOADING',
                        3: 'NETWORK_NO_SOURCE'
                    }[videoElement.networkState] || videoElement.networkState,
                    '就绪状态': {
                        0: 'HAVE_NOTHING',
                        1: 'HAVE_METADATA',
                        2: 'HAVE_CURRENT_DATA', 
                        3: 'HAVE_FUTURE_DATA',
                        4: 'HAVE_ENOUGH_DATA'
                    }[videoElement.readyState] || videoElement.readyState
                });
                
                // 显示错误信息和备用方案
                container.innerHTML = `
                    <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; text-align: center; padding: 20px;">
                        <i class="fas fa-exclamation-triangle" style="font-size: 3rem; color: var(--error-color); margin-bottom: 16px;"></i>
                        <h4 style="color: var(--error-color); margin: 8px 0;">视频加载失败</h4>
                        <p style="color: var(--text-secondary); margin-bottom: 16px;">无法播放视频文件，可能的原因：<br>• 浏览器不支持该视频格式<br>• ComfyUI服务器无响应<br>• 视频文件不存在或损坏<br>• 网络连接问题</p>
                        <div style="margin-top: 12px;">
                            <a href="${result.url}" target="_blank" style="color: var(--primary-color); text-decoration: none; padding: 8px 16px; border: 1px solid var(--primary-color); border-radius: 6px; margin: 0 8px;">
                                <i class="fas fa-download"></i> 下载视频
                            </a>
                            <button onclick="window.open('${result.url}', '_blank')" style="color: var(--text-color); background: var(--surface-color); border: 1px solid var(--border-color); border-radius: 6px; padding: 8px 16px; margin: 0 8px; cursor: pointer;">
                                <i class="fas fa-external-link-alt"></i> 新窗口打开
                            </button>
                        </div>
                        <div style="font-size: 0.875rem; color: var(--text-secondary); margin-top: 12px; word-break: break-all;">
                            文件：${result.filename || '未知'}<br>
                            URL：${result.url}
                        </div>
                    </div>
                `;
            };
            
            // 加载超时处理
            const loadTimeout = setTimeout(() => {
                if (videoElement.readyState === 0) {
                    console.warn('⏰ 视频加载超时(10秒):', result.url);
                    container.innerHTML = `
                        <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 200px; text-align: center; padding: 20px; border: 2px dashed var(--warning-color); border-radius: 8px;">
                            <i class="fas fa-clock" style="font-size: 3rem; color: var(--warning-color); margin-bottom: 16px;"></i>
                            <h4 style="color: var(--warning-color); margin: 8px 0;">视频加载超时</h4>
                            <p style="color: var(--text-secondary); margin-bottom: 16px;">视频文件加载超过10秒，可能是网络连接问题</p>
                            <div style="margin-top: 12px;">
                                <a href="${result.url}" target="_blank" style="color: var(--primary-color); text-decoration: none; padding: 8px 16px; border: 1px solid var(--primary-color); border-radius: 6px;">
                                    <i class="fas fa-external-link-alt"></i> 在新窗口打开
                                </a>
                            </div>
                        </div>
                    `;
                }
            }, 10000);
            
            // 详细的事件监听
            videoElement.onloadstart = () => {
                console.log('🎬 视频开始加载:', result.url);
            };
            
            videoElement.onloadedmetadata = () => {
                clearTimeout(loadTimeout);
                console.log('✅ 视频元数据加载成功:', {
                    filename: result.filename,
                    width: videoElement.videoWidth,
                    height: videoElement.videoHeight,
                    duration: Math.round(videoElement.duration || 0)
                });
            };
            
            videoElement.oncanplay = () => {
                console.log('✅ 视频可以播放:', result.filename);
            };
            
            // 网络状态事件
            videoElement.onstalled = function() {
                console.warn('视频加载停滞，可能是网络问题');
                // 显示缓冲指示器
                if (!container.querySelector('.buffering-indicator')) {
                    const bufferingDiv = document.createElement('div');
                    bufferingDiv.className = 'buffering-indicator';
                    bufferingDiv.style.cssText = 'position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.7); color: white; padding: 8px 12px; border-radius: 4px; font-size: 0.875rem; z-index: 10;';
                    bufferingDiv.innerHTML = '<i class="fas fa-spinner fa-spin"></i> 缓冲中...';
                    container.style.position = 'relative';
                    container.appendChild(bufferingDiv);
                }
            };
            
            videoElement.onwaiting = function() {
                console.log('视频等待缓冲');
            };
            
            // 可以播放事件
            videoElement.oncanplay = function() {
                console.log(`视频可以开始播放: ${result.filename || result.url}`);
                // 移除缓冲指示器
                const bufferingIndicator = container.querySelector('.buffering-indicator');
                if (bufferingIndicator) {
                    bufferingIndicator.remove();
                }
            };
            
            // 加载开始事件
            videoElement.onloadstart = function() {
                console.log(`开始加载视频: ${result.url}`);
            };
            
            // 加载进度事件
            videoElement.onprogress = function() {
                if (videoElement.buffered.length > 0) {
                    const bufferedEnd = videoElement.buffered.end(videoElement.buffered.length - 1);
                    const duration = videoElement.duration;
                    if (duration && !isNaN(duration)) {
                        const bufferedPercent = Math.round((bufferedEnd / duration) * 100);
                        console.log(`视频缓冲进度: ${bufferedPercent}%`);
                    }
                }
            };
            
            // 清空容器并添加视频元素
            container.innerHTML = '';
            container.appendChild(videoElement);
            
            console.log('🎬 视频元素已添加到DOM');
        } else if (result.type === 'audio') {
            container.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; text-align: center;">
                    <i class="fas fa-music" style="font-size: 4rem; color: var(--primary-color); margin-bottom: 16px;"></i>
                    <audio controls style="width: 80%;"
                           onerror="console.error('预览音频加载失败:', '${result.url}');">
                        <source src="${result.url}" type="audio/mpeg">
                        <source src="${result.url}" type="audio/wav">
                        <source src="${result.url}" type="audio/ogg">
                        您的浏览器不支持音频播放。
                    </audio>
                    <p style="margin-top: 12px; color: var(--text-secondary);">${result.filename}</p>
                </div>`;
        } else {
            container.innerHTML = `
                <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; height: 100%; text-align: center;">
                    <i class="fas fa-file" style="font-size: 4rem; color: var(--primary-color); margin-bottom: 16px;"></i>
                    <p style="color: var(--text-color); margin-bottom: 8px;">${result.filename}</p>
                    <a href="${result.url}" target="_blank" style="color: var(--primary-color); text-decoration: none;">下载文件</a>
                </div>`;
        }
    }

    // 添加到历史记录
    addToHistory(results) {
        const history = this.getStoredHistory();
        const timestamp = new Date().toISOString();
        
        results.forEach(result => {
            // 重新验证文件类型，防止错误分类
            let correctedType = result.type;
            if (result.filename) {
                const ext = result.filename.toLowerCase().split('.').pop();
                if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'].includes(ext)) {
                    correctedType = 'image';
                } else if (['mp4', 'avi', 'mov', 'webm', 'mkv', 'flv', '3gp', 'wmv', 'm4v', 'ogv', 'mts', 'ts', 'vob', 'asf', 'rm', 'rmvb', 'divx', 'xvid', 'f4v', 'm2ts', 'mpg', 'mpeg', 'qt'].includes(ext)) {
                    correctedType = 'video';
                    console.log(`🔧 修正历史记录中的文件类型: ${result.filename} -> video`);
                } else if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'opus'].includes(ext)) {
                    correctedType = 'audio';
                }
            }
            
            history.unshift({
                ...result,
                type: correctedType, // 使用修正后的类型
                timestamp,
                id: Date.now() + Math.random()
            });
        });
        
        // 限制历史记录数量
        if (history.length > 50) {
            history.splice(50);
        }
        
        localStorage.setItem('comfyui_history', JSON.stringify(history));
        // 使用增量更新而不是全量刷新，避免视频重新加载
        console.log('📝 使用增量更新添加新历史项目，避免全量刷新');
        this.addNewHistoryItems(results);
    }

    // 获取存储的历史记录
    getStoredHistory() {
        try {
            const history = JSON.parse(localStorage.getItem('comfyui_history') || '[]');
            // 修正历史记录中可能错误的文件类型
            const correctedHistory = history.map(item => {
                if (item.filename) {
                    const ext = item.filename.toLowerCase().split('.').pop();
                    let correctedType = item.type;
                    
                    if (['jpg', 'jpeg', 'png', 'gif', 'bmp', 'webp', 'svg'].includes(ext)) {
                        correctedType = 'image';
                    } else if (['mp4', 'avi', 'mov', 'webm', 'mkv', 'flv', '3gp', 'wmv', 'm4v', 'ogv', 'mts', 'ts', 'vob', 'asf', 'rm', 'rmvb', 'divx', 'xvid', 'f4v', 'm2ts', 'mpg', 'mpeg', 'qt'].includes(ext)) {
                        correctedType = 'video';
                        if (item.type !== 'video') {
                            console.log(`🔧 修正历史记录中的文件类型: ${item.filename} ${item.type} -> video`);
                        }
                    } else if (['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma', 'opus'].includes(ext)) {
                        correctedType = 'audio';
                    }
                    
                    return {
                        ...item,
                        type: correctedType
                    };
                }
                return item;
            });
            
            // 如果有修正，更新localStorage
            const hasChanges = correctedHistory.some((item, index) => item.type !== history[index]?.type);
            if (hasChanges) {
                localStorage.setItem('comfyui_history', JSON.stringify(correctedHistory));
                console.log('📝 已修正历史记录中的文件类型');
            }
            
            return correctedHistory;
        } catch {
            return [];
        }
    }

    // 加载历史记录
    loadHistory() {
        this.renderHistory();
    }

    // 渲染历史记录
    renderHistory() {
        const history = this.getStoredHistory();
        const historyGrid = document.getElementById('history-grid');
        
        if (!historyGrid) {
            console.warn('History grid element not found');
            return;
        }
        
        historyGrid.innerHTML = '';
        
        if (history.length === 0) {
            historyGrid.innerHTML = '<p style="grid-column: 1 / -1; text-align: center; color: var(--text-secondary);">暂无历史记录</p>';
            return;
        }
        
        history.forEach(item => {
            const historyItem = document.createElement('div');
            historyItem.className = 'history-item';
            
            // 使用当前服务器地址重新构建URL
            const currentUrl = this.updateHistoryItemUrl(item);
            const updatedItem = { ...item, url: currentUrl };
            
            historyItem.onclick = () => this.openHistoryPreview(updatedItem);
            
            const thumbnail = item.type === 'image' ? 
                `<img src="${currentUrl}" alt="历史记录" class="history-thumbnail">` :
                item.type === 'video' ?
                `<video src="${currentUrl}" class="history-thumbnail" muted preload="metadata" autoplay loop poster="${currentUrl}#t=0.1"></video>` :
                `<div class="history-thumbnail" style="display: flex; align-items: center; justify-content: center; background: var(--input-bg);"><i class="fas fa-file" style="font-size: 2rem; color: var(--primary-color);"></i></div>`;
            
            console.log('🎥 历史记录视频元素已添加自动循环播放:', item.filename);
            
            historyItem.innerHTML = `
                ${thumbnail}
                <div class="history-info">
                    <div class="history-time">${new Date(item.timestamp).toLocaleString()}</div>
                </div>
            `;
            
            historyGrid.appendChild(historyItem);
        });
    }

    // 更新历史记录项的URL，使用当前服务器地址
    updateHistoryItemUrl(item) {
        try {
            // 如果URL已经包含当前服务器地址，直接返回
            if (item.url.startsWith(window.comfyInterface.comfyUIUrl)) {
                return item.url;
            }
            
            // 提取URL中的查询参数
            const url = new URL(item.url);
            const searchParams = url.search;
            
            // 使用当前服务器地址重新构建URL
            const newUrl = `${window.comfyInterface.comfyUIUrl}/api/view${searchParams}`;
            console.log('🔄 更新历史记录URL:', item.url, '->', newUrl);
            return newUrl;
        } catch (error) {
            console.warn('更新历史记录URL失败，使用原URL:', error);
            return item.url;
        }
    }
    
    // 增量添加新历史项目
    addNewHistoryItems(results) {
        const historyGrid = document.getElementById('history-grid');
        if (!historyGrid) {
            console.warn('历史记录网格元素未找到');
            return;
        }
        
        console.log('📝 开始增量添加历史项目:', results.length);
        
        results.forEach(result => {
            const historyItem = this.createHistoryItem(result);
            // 将新项目插入到开头
            historyGrid.insertBefore(historyItem, historyGrid.firstChild);
        });
        
        // 限制显示的历史记录数量
        const historyItems = historyGrid.querySelectorAll('.history-item');
        if (historyItems.length > 50) {
            for (let i = 50; i < historyItems.length; i++) {
                historyItems[i].remove();
            }
        }
        
        console.log('✅ 增量添加历史项目完成');
    }
    
    // 创建单个历史记录项目
    createHistoryItem(item) {
        const historyItem = document.createElement('div');
        historyItem.className = 'history-item';
        
        // 使用当前服务器地址重新构建URL
        const currentUrl = this.updateHistoryItemUrl(item);
        const updatedItem = { ...item, url: currentUrl };
        
        historyItem.onclick = () => this.openHistoryPreview(updatedItem);
        
        const thumbnail = item.type === 'image' ? 
            `<img src="${currentUrl}" alt="历史记录" class="history-thumbnail">` :
            item.type === 'video' ?
            `<video src="${currentUrl}" class="history-thumbnail" muted preload="metadata" autoplay loop poster="${currentUrl}#t=0.1"></video>` :
            `<div class="history-thumbnail file-icon"><i class="fas fa-file" style="font-size: 2rem; color: var(--primary-color);"></i></div>`;
        
        console.log('🎥 历史记录项目已创建:', item.filename, '类型:', item.type);
        
        historyItem.innerHTML = `
            ${thumbnail}
            <div class="history-info">
                <div class="history-filename">${item.filename || '未知文件'}</div>
                <div class="history-time">${new Date(item.timestamp).toLocaleString()}</div>
            </div>
        `;
        
        return historyItem;
    }
    
    // 新增：打开历史记录预览
    openHistoryPreview(item) {
        openFilePreview(item.url, item.type, item.filename);
    }

    // 查看历史记录项（保留原有方法作为备用）
    viewHistoryItem(item) {
        const previewContainer = document.getElementById('preview-container');
        this.displayInPreview(previewContainer, item);
    }

    // 清除历史记录
    clearHistory() {
        if (confirm('确定要清除所有历史记录吗？')) {
            localStorage.removeItem('comfyui_history');
            this.renderHistory();
        }
    }

    // 获取节点标题
    getNodeTitle(nodeId) {
        if (!this.currentWorkflow || !this.currentWorkflow[nodeId]) {
            return null;
        }
        
        const node = this.currentWorkflow[nodeId];
        
        // 优先使用 _meta.title
        if (node._meta && node._meta.title) {
            return node._meta.title;
        }
        
        // 其次使用 class_type
        if (node.class_type) {
            return node.class_type;
        }
        
        return null;
    }
    
    // 更新进度
    updateProgress(text, percentage) {
        document.getElementById('progress-text').textContent = text;
        document.getElementById('progress-percentage').textContent = `${percentage}%`;
        document.getElementById('progress-fill').style.width = `${percentage}%`;
    }

    // 开始更新耗时显示
    startElapsedTimeUpdate() {
        if (this.elapsedTimeInterval) {
            clearInterval(this.elapsedTimeInterval);
        }
        
        this.elapsedTimeInterval = setInterval(() => {
            if (this.startTime) {
                const elapsed = Date.now() - this.startTime;
                const seconds = Math.floor(elapsed / 1000);
                const minutes = Math.floor(seconds / 60);
                const remainingSeconds = seconds % 60;
                const timeString = `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
                
                const elapsedTimeElement = document.getElementById('elapsed-time');
                if (elapsedTimeElement) {
                    elapsedTimeElement.textContent = timeString;
                }
            }
        }, 1000);
    }

    // 停止更新耗时显示
    stopElapsedTimeUpdate() {
        if (this.elapsedTimeInterval) {
            clearInterval(this.elapsedTimeInterval);
            this.elapsedTimeInterval = null;
        }
    }

    // 更新连接状态
    updateConnectionStatus(connected) {
        this.isConnected = connected;
        const statusElement = document.getElementById('connection-status');
        
        if (connected) {
            statusElement.textContent = '已连接';
            statusElement.className = 'status online';
        } else {
            statusElement.textContent = '未连接';
            statusElement.className = 'status offline';
        }
    }

    // 设置生成按钮状态
    setGenerateButtonState(enabled) {
        const button = document.getElementById('generate-btn');
        button.disabled = !enabled;
        
        if (enabled) {
            button.innerHTML = '<i class="fas fa-play"></i><span>生成内容</span>';
        } else {
            button.innerHTML = '<i class="fas fa-spinner fa-spin"></i><span>生成中...</span>';
        }
    }

    // 显示加载状态
    showLoading(show) {
        const overlay = document.getElementById('loading-overlay');
        if (show) {
            overlay.classList.add('show');
        } else {
            overlay.classList.remove('show');
        }
    }

    // 显示错误信息
    showError(message) {
        this.showDetailedError('错误', new Error(message));
    }
    
    // 显示详细错误信息
    showDetailedError(title, error) {
        const progressText = document.getElementById('progress-text');
        const progressPercentage = document.getElementById('progress-percentage');
        const progressFill = document.getElementById('progress-fill');
        
        if (progressText && progressPercentage && progressFill) {
            // 在进度区域显示错误信息
            progressText.textContent = `${title}: ${error.message}`;
            progressPercentage.textContent = '失败';
            progressFill.style.width = '100%';
            progressFill.style.background = 'var(--error-color)';
            
            // 显示详细诊断信息
            setTimeout(() => {
                // 再次检查元素是否存在
                const currentProgressText = document.getElementById('progress-text');
                if (currentProgressText) {
                    const diagnostics = this.generateDiagnostics(error);
                    currentProgressText.innerHTML = `
                        <div style="color: var(--error-color); margin-bottom: 8px;">${title}: ${error.message}</div>
                        <div style="font-size: 0.875rem; color: var(--text-secondary); line-height: 1.4;">${diagnostics}</div>
                    `;
                } else {
                    console.warn('Progress text element not found during error display');
                }
            }, 1000);
        } else {
            // 备用方案：使用alert
            alert(`${title}: ${error.message}`);
            console.warn('Progress elements not found:', { progressText: !!progressText, progressPercentage: !!progressPercentage, progressFill: !!progressFill });
        }
        
        console.error(`${title}:`, error);
    }
    
    // 生成诊断信息
    generateDiagnostics(error) {
        const diagnostics = [];
        
        if (error.message.includes('无法连接到ComfyUI服务')) {
            diagnostics.push('🔍 请检查：');
            diagnostics.push('• ComfyUI是否正在运行？');
            diagnostics.push('• 是否监听端口8188？');
            diagnostics.push('• 防火墙是否阻止了连接？');
        } else if (error.message.includes('任务超时')) {
            diagnostics.push('🕰️ 超时原因：');
            diagnostics.push('• 工作流太复杂，处理时间超过30秒');
            diagnostics.push('• ComfyUI服务器资源不足');
            diagnostics.push('• WebSocket连接中断');
        } else if (error.message.includes('WebSocket')) {
            diagnostics.push('🔌 WebSocket问题：');
            diagnostics.push('• 网络连接不稳定');
            diagnostics.push('• ComfyUI WebSocket服务未启动');
            diagnostics.push('• 端口被占用或被阻止');
        } else {
            diagnostics.push('🔧 建议解决方案：');
            diagnostics.push('• 重新加载页面');
            diagnostics.push('• 检查ComfyUI控制台是否有错误信息');
            diagnostics.push('• 尝试使用简单的工作流');
        }
        
        return diagnostics.join('<br>');
    }
    
    // 检查连接状态
    async checkConnectionStatus() {
        try {
            // 设置5秒超时
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 5000);
            
            const response = await fetch(`${this.comfyUIUrl}/system_stats`, {
                method: 'GET',
                signal: controller.signal
            });
            
            clearTimeout(timeoutId);
            return response.ok;
        } catch (error) {
            console.error('连接检查失败:', error);
            
            // 如果当前服务器地址失败，尝试回退到本地地址
            if (this.comfyUIUrl !== 'http://127.0.0.1:8188') {
                console.warn('连接检查失败，尝试回退到本地地址:', error.message);
                try {
                    const controller = new AbortController();
                    const timeoutId = setTimeout(() => controller.abort(), 5000);
                    
                    const fallbackResponse = await fetch('http://127.0.0.1:8188/system_stats', {
                        method: 'GET',
                        signal: controller.signal
                    });
                    
                    clearTimeout(timeoutId);
                    
                    if (fallbackResponse.ok) {
                        // 回退成功，更新服务器地址
                        this.updateServerUrl('127.0.0.1:8188');
                        this.showSuccessNotification('已自动切换到本地服务器地址');
                        return true;
                    }
                } catch (fallbackError) {
                    console.error('回退到本地地址也失败:', fallbackError);
                }
            }
            
            return false;
        }
    }
    
    // 设置任务超时（改为无限期等待）
    setupTaskTimeout(taskId) {
        // 移除30秒超时限制，改为无限期等待
        // 任务将持续运行直到完成或用户手动取消
        console.log('任务已提交，无限期等待完成:', taskId);
        
        // 开始定期查询队列状态
        this.startQueueStatusCheck(taskId);
    }
    
    // 清除任务超时
    clearTaskTimeout() {
        if (this.taskTimeout) {
            clearTimeout(this.taskTimeout);
            this.taskTimeout = null;
        }
    }
    
    // 开始队列状态检查
    startQueueStatusCheck(taskId) {
        // 每2秒检查一次队列状态
        this.queueCheckInterval = setInterval(async () => {
            try {
                await this.checkQueueStatus(taskId);
            } catch (error) {
                console.error('队列状态检查错误:', error);
            }
        }, 2000);
    }
    
    // 检查队列状态
    async checkQueueStatus(taskId) {
        try {
            const response = await fetch(`${this.comfyUIUrl}/queue`);
            
            if (!response.ok) {
                console.warn('无法获取队列状态:', response.statusText);
                return;
            }
            
            const queueData = await response.json();
            console.log('队列数据:', queueData);
            
            // 查找当前任务在队列中的位置
            let position = -1;
            let totalPending = 0;
            let totalRunning = 0;
            
            // 检查正在运行的任务
            if (queueData.queue_running && Array.isArray(queueData.queue_running)) {
                totalRunning = queueData.queue_running.length;
                
                const runningIndex = queueData.queue_running.findIndex(item => {
                    return Array.isArray(item) && item.length > 1 && item[1] === taskId;
                });
                
                if (runningIndex !== -1) {
                    position = 0; // 正在运行
                }
            }
            
            // 检查等待队列
            if (queueData.queue_pending && Array.isArray(queueData.queue_pending)) {
                totalPending = queueData.queue_pending.length;
                
                if (position === -1) {
                    const pendingIndex = queueData.queue_pending.findIndex(item => {
                        return Array.isArray(item) && item.length > 1 && item[1] === taskId;
                    });
                    
                    if (pendingIndex !== -1) {
                        position = pendingIndex + 1; // 在等待队列中的位置（从1开始）
                    }
                }
            }
            
            // 更新队列状态显示
            this.updateQueueStatus(position, totalPending, totalRunning, taskId);
            
        } catch (error) {
            console.error('获取队列状态失败:', error);
        }
    }
    
    // 更新队列状态显示
    updateQueueStatus(position, totalPending, totalRunning, taskId) {
        const progressText = document.getElementById('progress-text');
        if (!progressText) return;
        
        const totalTasks = totalRunning + totalPending;
        let statusText = '';
        
        const runningText = window.languageManager ? window.languageManager.t('interface.running') : '运行中';
        const waitingText = window.languageManager ? window.languageManager.t('interface.waiting') : '等待中';
        const totalTasksText = window.languageManager ? window.languageManager.t('interface.totalTasks') : '总任务';
        
        let queueInfo = `${totalRunning}${runningText} | ${totalPending}${waitingText} | ${totalTasksText}${totalTasks}`;
        
        if (position === 0) {
            statusText = window.languageManager ? `🟢 ${window.languageManager.t('interface.executingYourTask')}` : '🟢 正在执行您的任务';
        } else if (position > 0) {
            const waitingInQueueText = window.languageManager ? window.languageManager.t('interface.waitingInQueue') : '排队等待中 - 第';
            const positionText = window.languageManager ? window.languageManager.t('interface.position') : '位';
            statusText = `⏳ ${waitingInQueueText} ${position} ${positionText}`;
            
            const tasksAheadText = window.languageManager ? window.languageManager.t('interface.tasksAhead') : '前面还有';
            const tasksText = window.languageManager ? window.languageManager.t('interface.tasks') : '个任务';
            queueInfo += ` | ${tasksAheadText}${position - 1}${tasksText}`;
        } else {
            // 任务不在队列中，可能已完成或出错
            statusText = window.languageManager ? `🔍 ${window.languageManager.t('interface.checkingTaskStatus')}` : '🔍 检查任务状态中...';
        }
        
        // 更新进度文本，包含队列信息
        progressText.innerHTML = `
            <div style="margin-bottom: 4px;">${statusText}</div>
            <div style="font-size: 0.875rem; color: var(--text-secondary); opacity: 0.8;">
                ${queueInfo}
            </div>
        `;
    }
    
    // 清除队列状态检查
    clearQueueStatusCheck() {
        if (this.queueCheckInterval) {
            clearInterval(this.queueCheckInterval);
            this.queueCheckInterval = null;
        }
    }
    
    // 启动结果轮询检查（无限期）
    startPollingForResults(taskId) {
        // 每3秒检查一次，无限期等待直到任务完成
        let pollCount = 0;
        
        const pollInterval = setInterval(async () => {
            pollCount++;
            console.log(`轮询检查 ${pollCount}: ${taskId}`);
            
            try {
                const history = await this.getHistory(taskId);
                
                // 检查这个任务是否已经有结果
                if (history && history[taskId] && history[taskId].outputs) {
                    console.log(`轮询发现结果，任务已完成: ${taskId}`);
                    clearInterval(pollInterval);
                    
                    if (this.currentTaskId === taskId) {
                        this.handleTaskCompleted(taskId);
                    }
                    return;
                }
                
            } catch (error) {
                console.error(`轮询检查错误:`, error);
                // 不停止轮询，继续尝试
            }
        }, 3000);
        
        // 保存轮询间隔ID，以便清理
        this.pollInterval = pollInterval;
    }
    
    // 清除轮询检查
    clearPolling() {
        if (this.pollInterval) {
            clearInterval(this.pollInterval);
            this.pollInterval = null;
        }
        
        // 同时清除队列状态检查
        this.clearQueueStatusCheck();
    }
}

// 全局函数
function generateContent() {
    window.comfyInterface.generateContent();
}

function goBack() {
    if (window.history.length > 1) {
        window.history.back();
    } else {
        window.location.href = './index.html';
    }
}

function clearHistory() {
    window.comfyInterface.clearHistory();
}

// ============ 设置功能 ============

// 设置管理器
class SettingsManager {
    constructor() {
        this.defaultSettings = {
            serverIp: 'localhost:8188',
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
        
        this.applySettings();
    }
    
    saveSettings() {
        try {
            localStorage.setItem('comfyui-settings', JSON.stringify(this.currentSettings));
            console.log('设置已保存:', this.currentSettings);
            return true;
        } catch (error) {
            console.error('保存设置失败:', error);
            return false;
        }
    }
    
    applySettings() {
        // 应用主题
        this.applyTheme(this.currentSettings.defaultTheme);
        
        // 更新ComfyUI服务器地址
        if (window.comfyInterface) {
            window.comfyInterface.updateServerUrl(this.currentSettings.serverIp);
        }
    }
    
    applyTheme(theme) {
        const body = document.body;
        if (theme === 'light') {
            body.classList.remove('dark-theme');
            body.classList.add('light-theme');
        } else {
            body.classList.remove('light-theme');
            body.classList.add('dark-theme');
        }
        
        // 更新主题按钮状态
        this.updateThemeButtons(theme);
    }
    
    // 更新主题按钮状态
    updateThemeButtons(activeTheme) {
        const darkBtn = document.getElementById('dark-theme-btn');
        const lightBtn = document.getElementById('light-theme-btn');
        
        if (darkBtn && lightBtn) {
            darkBtn.classList.toggle('active', activeTheme === 'dark');
            lightBtn.classList.toggle('active', activeTheme === 'light');
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
        this.applySettings();
    }
    
    getDefaultLanguage() {
        if (this.currentSettings.language === 'auto') {
            const systemLang = navigator.language || navigator.userLanguage || 'zh-CN';
            const supportedLanguages = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko', 'fr', 'de', 'ar', 'ru', 'hi', 'es'];
            const matchedLang = supportedLanguages.find(lang => 
                systemLang.toLowerCase().startsWith(lang.toLowerCase()) ||
                systemLang.toLowerCase().includes(lang.toLowerCase())
            );
            return matchedLang || 'zh-CN';
        }
        return this.currentSettings.language;
    }
}

// 多语言管理器
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
    
    async loadLanguage(langCode) {
        if (this.loadedLanguages.has(langCode)) {
            return;
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
            this.translations[langCode] = this.getFallbackTranslations(langCode);
            this.loadedLanguages.add(langCode);
        }
    }
    
    getFallbackTranslations(langCode) {
        const fallbacks = {
            'zh-CN': {
                title: 'ComfyUI 工作流界面',
                back_to_home: '返回主页',
                not_connected: '未连接',
                connected: '已连接'
            },
            'en': {
                title: 'ComfyUI Workflow Interface',
                back_to_home: 'Back to Home',
                not_connected: 'Not Connected',
                connected: 'Connected'
            }
        };
        
        return fallbacks[langCode] || fallbacks['zh-CN'];
    }
    
    async setLanguage(langCode) {
        if (!this.loadedLanguages.has(langCode)) {
            await this.loadLanguage(langCode);
        }
        
        this.currentLanguage = langCode;
        console.log(`🌍 语言已切换为: ${langCode} (${this.languageNames[langCode]})`);
        this.updateUI();
    }
    
    t(keyPath) {
        const translation = this.translations[this.currentLanguage];
        if (!translation) {
            console.warn(`翻译不存在: ${this.currentLanguage}`);
            return keyPath;
        }
        
        const keys = keyPath.split('.');
        let value = translation;
        
        for (const key of keys) {
            if (value && typeof value === 'object' && key in value) {
                value = value[key];
            } else {
                return keyPath;
            }
        }
        
        return value || keyPath;
    }
    
    updateUI() {
        document.title = 'ComfyUI_XLWEB';
        
        const elementsToTranslate = document.querySelectorAll('[data-i18n]');
        elementsToTranslate.forEach(element => {
            const key = element.getAttribute('data-i18n');
            
            if (key === 'title') {
                element.textContent = 'ComfyUI_XLWEB';
                return;
            }
            
            const translation = this.t(key);
            if (translation && translation !== key) {
                element.textContent = translation;
            }
        });
        
        const placeholderElements = document.querySelectorAll('[data-i18n-placeholder]');
        placeholderElements.forEach(element => {
            const key = element.getAttribute('data-i18n-placeholder');
            const translation = this.t(key);
            if (translation && translation !== key) {
                element.placeholder = translation;
            }
        });
        
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
    
    getCurrentLanguage() {
        return this.currentLanguage;
    }
    
    getLanguageName(langCode) {
        return this.languageNames[langCode] || langCode;
    }
    
    getSupportedLanguages() {
        return Object.keys(this.languageNames);
    }
}

// 设置管理器将在 app.js 中初始化

// ============ 文件预览功能 ============

// 当前预览的文件信息
let currentPreviewFile = null;

// 打开文件预览
function openFilePreview(url, type, filename) {
    const modal = document.getElementById('file-preview-modal');
    const content = document.querySelector('.file-preview-media');
    const info = document.getElementById('file-preview-info');
    const downloadBtn = document.getElementById('file-preview-download');
    
    // 保存当前文件信息
    currentPreviewFile = { url, type, filename };
    
    // 清空内容
    content.innerHTML = '';
    
    // 根据文件类型显示预览
    if (type === 'image') {
        const img = document.createElement('img');
        img.src = url;
        img.alt = filename;
        img.onerror = function() {
            content.innerHTML = `
                <div style="text-align: center; color: white; padding: 40px;">
                    <i class="fas fa-exclamation-triangle" style="font-size: 3rem; margin-bottom: 16px; color: #ff6b6b;"></i>
                    <h3>图像加载失败</h3>
                    <p>无法显示图像文件</p>
                </div>
            `;
        };
        content.appendChild(img);
    } else if (type === 'video') {
        const video = document.createElement('video');
        video.src = url;
        video.controls = true;
        video.autoplay = false;
        video.preload = 'metadata';
        
        video.onerror = function() {
            content.innerHTML = `
                <div style="text-align: center; color: white; padding: 40px;">
                    <i class="fas fa-exclamation-triangle" style="font-size: 3rem; margin-bottom: 16px; color: #ff6b6b;"></i>
                    <h3>视频加载失败</h3>
                    <p>无法播放视频文件</p>
                </div>
            `;
        };
        
        content.appendChild(video);
    } else {
        // 其他文件类型
        content.innerHTML = `
            <div style="text-align: center; color: white; padding: 40px;">
                <i class="fas fa-file" style="font-size: 4rem; margin-bottom: 16px; color: var(--primary-color);"></i>
                <h3>${filename}</h3>
                <p>此文件类型不支持预览</p>
            </div>
        `;
    }
    
    // 设置文件信息
    info.textContent = `${filename} - ${type.toUpperCase()}`;
    
    // 设置下载链接
    downloadBtn.href = url;
    downloadBtn.download = filename;
    
    // 显示模态框
    modal.classList.add('show');
    document.body.style.overflow = 'hidden';
    
    // 添加键盘事件监听
    document.addEventListener('keydown', handlePreviewKeydown);
}

// 关闭文件预览
function closeFilePreview() {
    const modal = document.getElementById('file-preview-modal');
    modal.classList.remove('show');
    document.body.style.overflow = '';
    currentPreviewFile = null;
    
    // 移除键盘事件监听
    document.removeEventListener('keydown', handlePreviewKeydown);
}

// 在新标签页中打开
function openInNewTab() {
    if (currentPreviewFile) {
        window.open(currentPreviewFile.url, '_blank');
    }
}

// 处理键盘事件
function handlePreviewKeydown(e) {
    if (e.key === 'Escape') {
        closeFilePreview();
    }
}

// 点击模态框背景关闭
document.addEventListener('DOMContentLoaded', function() {
    const modal = document.getElementById('file-preview-modal');
    if (modal) {
        modal.addEventListener('click', function(e) {
            if (e.target === modal) {
                closeFilePreview();
            }
        });
    }
});

// 结果详情面板控制
function closeResultDetails() {
    const detailsPanel = document.getElementById('result-details');
    if (detailsPanel) {
        detailsPanel.classList.remove('open');
    }
}



// 设置功能全局函数
function openSettings() {
    const modal = document.getElementById('settings-modal');
    if (modal) {
        // 加载当前设置到表单（确保显示最新的保存值）
        loadSettingsToForm();
        modal.classList.add('show');
        
        // 防止背景滚动
        document.body.style.overflow = 'hidden';
        
        console.log('💾 ComfyUI界面打开设置，当前服务器地址:', window.settingsManager.getSetting('serverIp'));
    }
}

function closeSettings() {
    const modal = document.getElementById('settings-modal');
    if (modal) {
        modal.classList.remove('show');
        
        // 恢复背景滚动
        document.body.style.overflow = '';
    }
}

function saveSettings() {
    try {
        // 从表单获取设置值
        const serverIpInput = document.getElementById('server-ip').value.trim();
        const imageSizeLimit = parseInt(document.getElementById('image-size-limit').value);
        const videoSizeLimit = parseInt(document.getElementById('video-size-limit').value);
        const audioSizeLimit = parseInt(document.getElementById('audio-size-limit').value);
        const defaultTheme = document.getElementById('default-theme').value;
        const language = document.getElementById('language-select').value;
        
        // 验证输入
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
            window.settingsManager.applySettings();
            
            // 显示保存成功消息
            showNotification('设置已保存，服务器地址已更新', 'success');
            
            // 立即更新服务器连接
            if (window.comfyInterface) {
                console.log('🔄 立即更新服务器连接到:', serverAddress);
                window.comfyInterface.updateServerUrl(serverAddress);
                showNotification('服务器地址已立即生效', 'success');
            }
            
            // 关闭设置对话框
            setTimeout(() => {
                closeSettings();
            }, 1000);
        } else {
            showNotification('保存设置失败', 'error');
        }
    } catch (error) {
        console.error('保存设置时出错:', error);
        showNotification('保存设置时出错: ' + error.message, 'error');
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
        
        console.log('🔄 ComfyUI界面设置已重置为默认值:', window.settingsManager.currentSettings);
        
        // 立即更新服务器连接
        if (window.comfyInterface) {
            const defaultServerIp = window.settingsManager.getSetting('serverIp');
            console.log('🔄 重置后立即更新服务器地址到:', defaultServerIp);
            window.comfyInterface.updateServerUrl(defaultServerIp);
        }
        
        showNotification('设置已重置为默认值', 'success');
    }
}

function switchTheme(theme) {
    window.settingsManager.applyTheme(theme);
    
    // 更新默认主题选择
    const defaultThemeSelect = document.getElementById('default-theme');
    if (defaultThemeSelect) {
        defaultThemeSelect.value = theme;
    }
}

// 加载设置到表单
function loadSettingsToForm() {
    const settings = window.settingsManager.currentSettings;
    
    // 服务器设置
    const serverIpInput = document.getElementById('server-ip');
    if (serverIpInput) {
        serverIpInput.value = settings.serverIp;
        console.log('📝 ComfyUI界面加载保存的服务器地址:', settings.serverIp);
    }
    
    // 文件大小限制
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
    
    // 主题设置
    const defaultThemeSelect = document.getElementById('default-theme');
    if (defaultThemeSelect) {
        defaultThemeSelect.value = settings.defaultTheme;
    }
    
    // 语言设置
    const languageSelect = document.getElementById('language-select');
    if (languageSelect) {
        languageSelect.value = settings.language || 'auto';
    }
    
    // 更新主题按钮状态
    window.settingsManager.updateThemeButtons(settings.defaultTheme);
}

// 显示通知消息
function showNotification(message, type = 'info') {
    // 创建通知元素
    const notification = document.createElement('div');
    notification.className = `notification notification-${type}`;
    notification.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: var(--surface-color);
        border: 1px solid var(--border-color);
        border-radius: 8px;
        padding: 16px 20px;
        box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
        z-index: 1001;
        max-width: 400px;
        backdrop-filter: blur(10px);
        transform: translateX(100%);
        transition: transform 0.3s ease;
    `;
    
    // 根据类型设置颜色
    const colors = {
        success: 'var(--success-color)',
        error: 'var(--error-color)',
        warning: 'var(--warning-color)',
        info: 'var(--primary-color)'
    };
    
    notification.innerHTML = `
        <div style="display: flex; align-items: center; gap: 12px; color: var(--text-color);">
            <div style="width: 4px; height: 40px; background: ${colors[type]}; border-radius: 2px;"></div>
            <div style="flex: 1;">
                <div style="font-weight: 500; margin-bottom: 4px;">${type.charAt(0).toUpperCase() + type.slice(1)}</div>
                <div style="font-size: 0.875rem; color: var(--text-secondary);">${message}</div>
            </div>
            <button onclick="this.parentElement.parentElement.remove()" 
                    style="background: none; border: none; color: var(--text-secondary); cursor: pointer; padding: 4px;">
                <i class="fas fa-times"></i>
            </button>
        </div>
    `;
    
    document.body.appendChild(notification);
    
    // 动画显示
    setTimeout(() => {
        notification.style.transform = 'translateX(0)';
    }, 100);
    
    // 自动移除
    setTimeout(() => {
        notification.style.transform = 'translateX(100%)';
        setTimeout(() => {
            if (notification.parentElement) {
                notification.remove();
            }
        }, 300);
    }, 3000);
}

// 键盘快捷键支持
document.addEventListener('keydown', (e) => {
    // ESC键关闭设置对话框
    if (e.key === 'Escape') {
        const modal = document.getElementById('settings-modal');
        if (modal && modal.classList.contains('show')) {
            closeSettings();
        }
    }
    
    // Ctrl+S 保存设置
    if (e.ctrlKey && e.key === 's') {
        const modal = document.getElementById('settings-modal');
        if (modal && modal.classList.contains('show')) {
            e.preventDefault();
            saveSettings();
        }
    }
});

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
        return 'http://localhost:8188';
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

// 初始化
document.addEventListener('DOMContentLoaded', async () => {
    try {
        // 初始化管理器
        window.settingsManager = new SettingsManager();
        window.languageManager = new LanguageManager();
        
        console.log('✅ 管理器初始化完成');
        
        // 初始化语言系统
        await initializeLanguageSystem();
        
        // 加载保存的设置到表单
        setTimeout(() => {
            loadSettingsToForm();
        }, 100);
        
        // 初始化ComfyUI接口
        window.comfyInterface = new ComfyUIInterface();
        
        // 强制应用设置中的服务器地址
        const savedServerIp = window.settingsManager.getSetting('serverIp');
        if (savedServerIp) {
            console.log('🔄 应用保存的服务器地址:', savedServerIp);
            window.comfyInterface.updateServerUrl(savedServerIp);
        }
        
        console.log('✅ 界面初始化完成');
    } catch (error) {
        console.error('❌ 界面初始化失败:', error);
        // 即使管理器初始化失败，也要初始化ComfyUI接口
        window.comfyInterface = new ComfyUIInterface();
    }
});

// 初始化语言系统
async function initializeLanguageSystem() {
    try {
        // 获取保存的语言设置
        const savedLanguage = window.settingsManager.getSetting('language') || 'auto';
        let targetLanguage = savedLanguage;
        
        // 如果是自动模式，获取系统语言
        if (savedLanguage === 'auto') {
            targetLanguage = window.settingsManager.getDefaultLanguage();
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

// 应用语言设置
async function applyLanguageSetting(language) {
    try {
        let targetLanguage = language;
        
        // 如果是自动模式，获取系统语言
        if (language === 'auto') {
            targetLanguage = window.settingsManager.getDefaultLanguage();
        }
        
        console.log(`🔄 应用语言设置: ${language} -> ${targetLanguage}`);
        
        // 加载并应用语言
        await window.languageManager.setLanguage(targetLanguage);
        
        showNotification(window.languageManager.t('messages.languageUpdated') || '语言设置已更新', 'success');
        
    } catch (error) {
        console.error('应用语言设置失败:', error);
        showNotification('语言设置失败: ' + error.message, 'error');
    }
}