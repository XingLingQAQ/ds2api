# DS2API Docker 镜像
# 采用极简、零侵入设计，所有配置通过环境变量传递
# 主代码更新时只需重新构建镜像，无需修改 Dockerfile

FROM node:20 AS webui-builder

WORKDIR /app/webui

COPY webui/package.json webui/package-lock.json ./
RUN npm ci

COPY webui ./
RUN npm run build

FROM python:3.11-slim

WORKDIR /app

# 安装依赖（利用 Docker 缓存层）
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制整个项目（保留原始目录结构）
COPY . .

# 拷贝 WebUI 构建产物（非 Vercel / Docker 部署可直接使用）
COPY --from=webui-builder /app/static/admin /app/static/admin

# 暴露服务端口
EXPOSE 5001

# 启动命令（依赖项目自身的启动逻辑）
CMD ["python", "app.py"]
