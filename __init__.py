import os
import aiohttp
from aiohttp import web
import folder_paths
import logging

# 获取当前文件所在目录的绝对路径
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))

# 注册ComfyUI_XLweb作为ComfyUI的插件
class XLwebExtension:
    @classmethod
    def add_routes(cls, routes, app, *args):
        # 添加路由处理程序，将/xlweb路径映射到ComfyUI_XLweb目录
        @routes.get('/xlweb')
        async def xlweb_index(request):
            # 重定向到/xlweb/
            return web.HTTPFound('/xlweb/')

        @routes.get('/xlweb/')
        async def xlweb_root(request):
            # 返回index.html文件
            file_path = os.path.join(CURRENT_DIR, 'index.html')
            if os.path.exists(file_path):
                logging.info(f"Serving XLweb index.html from {file_path}")
                return web.FileResponse(file_path)
            else:
                logging.error(f"XLweb index.html not found at {file_path}")
                return web.Response(text=f"XLweb index.html not found at {file_path}", status=404)
                
        # 添加对/extensions/xlweb路径的支持
        @routes.get('/extensions/xlweb')
        async def extensions_xlweb_index(request):
            # 重定向到/extensions/xlweb/index.html
            return web.HTTPFound('/extensions/xlweb/index.html')

        # 添加静态文件路由
        @routes.get('/xlweb/{filename:.*}')
        async def xlweb_static(request):
            filename = request.match_info['filename']
            file_path = os.path.join(CURRENT_DIR, filename)
            
            logging.info(f"XLweb requested file: {filename}, path: {file_path}")
            
            if os.path.exists(file_path):
                if os.path.isfile(file_path):
                    return web.FileResponse(file_path)
                elif os.path.isdir(file_path):
                    # 返回目录列表的HTML
                    try:
                        items = os.listdir(file_path)
                        html_content = '<html><body>'
                        for item in items:
                            item_path = os.path.join(file_path, item)
                            if os.path.isdir(item_path):
                                html_content += f'<a href="{item}/">{item}/</a><br>'
                            else:
                                html_content += f'<a href="{item}">{item}</a><br>'
                        html_content += '</body></html>'
                        return web.Response(text=html_content, content_type='text/html')
                    except Exception as e:
                        logging.error(f"Error listing directory {file_path}: {e}")
                        return web.Response(text=f"Error listing directory: {e}", status=500)
            
            logging.error(f"XLweb file not found: {file_path}")
            return web.Response(text=f"File not found: {filename}", status=404)

# 获取ComfyUI服务器的URL
def get_server_url():
    import socket
    hostname = socket.gethostname()
    ip = socket.gethostbyname(hostname)
    port = 8188  # ComfyUI默认端口
    return f"http://{ip}:{port}"

# 修改interface-script.js文件中的服务器IP配置
def update_server_config():
    js_file_path = os.path.join(CURRENT_DIR, 'interface-script.js')
    
    if os.path.exists(js_file_path):
        with open(js_file_path, 'r', encoding='utf-8') as file:
            content = file.read()
        
        # 获取当前ComfyUI服务器URL
        server_url = get_server_url()
        
        # 提取主机名和端口
        import urllib.parse
        parsed_url = urllib.parse.urlparse(server_url)
        server_ip = parsed_url.netloc
        
        # 更新CONFIG对象中的SERVER_IP
        import re
        updated_content = re.sub(
            r'const CONFIG = \{\s*SERVER_IP: [\'"](.*?)[\'"],', 
            f'const CONFIG = {{\n    SERVER_IP: \'{server_ip}\',', 
            content
        )
        
        with open(js_file_path, 'w', encoding='utf-8') as file:
            file.write(updated_content)

# 初始化函数
def setup():
    update_server_config()
    logging.info("ComfyUI_XLweb插件已注册，可通过/xlweb访问")

# 执行初始化
setup()

# 注册NODE_CLASS_MAPPINGS（即使为空，也需要定义以便ComfyUI识别为插件）
NODE_CLASS_MAPPINGS = {}
WEB_DIRECTORY = "."

# 注册web扩展目录
import nodes
# 使用固定的键名"xlweb"，而不是模块名称
nodes.EXTENSION_WEB_DIRS["xlweb"] = CURRENT_DIR
logging.info(f"注册web扩展目录: xlweb -> {CURRENT_DIR}")
# 确保index.html存在
index_path = os.path.join(CURRENT_DIR, 'index.html')
if os.path.exists(index_path):
    logging.info(f"XLweb index.html found at {index_path}")
else:
    logging.warning(f"XLweb index.html not found at {index_path}")

# 注册路由
try:
    from server import PromptServer
    XLwebExtension.add_routes(PromptServer.instance.routes, PromptServer.instance.app)
    logging.info("XLweb routes registered successfully")
except Exception as e:
    logging.error(f"Failed to register XLweb routes: {e}")