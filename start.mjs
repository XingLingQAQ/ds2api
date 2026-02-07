#!/usr/bin/env node
/**
 * DS2API 启动脚本 - 交互式菜单
 *
 * 使用方法:
 *   node start.mjs          # 显示交互式菜单
 *   node start.mjs dev      # 开发模式（后端+前端）
 *   node start.mjs prod     # 生产模式
 */

import { spawn, execSync } from 'child_process';
import { createInterface } from 'readline';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// 判断是否为 Windows
const isWindows = process.platform === 'win32';

// 配置
const CONFIG = {
  backendPort: process.env.PORT || 5001,
  frontendPort: 5173,
  host: process.env.HOST || '0.0.0.0',
  logLevel: process.env.LOG_LEVEL || 'info',
  adminKey: process.env.DS2API_ADMIN_KEY || 'ds2api',
  webuiDir: join(__dirname, 'webui'),
  venvDir: join(__dirname, '.venv'),
};

// venv 中的可执行文件路径
const VENV = {
  python: isWindows
    ? join(CONFIG.venvDir, 'Scripts', 'python.exe')
    : join(CONFIG.venvDir, 'bin', 'python'),
  pip: isWindows
    ? join(CONFIG.venvDir, 'Scripts', 'pip.exe')
    : join(CONFIG.venvDir, 'bin', 'pip'),
};

// 存储子进程
const processes = [];

// 颜色输出
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
};

const log = {
  info: (msg) => console.log(`${colors.cyan}[INFO]${colors.reset} ${msg}`),
  success: (msg) => console.log(`${colors.green}[OK]${colors.reset} ${msg}`),
  warn: (msg) => console.log(`${colors.yellow}[WARN]${colors.reset} ${msg}`),
  error: (msg) => console.log(`${colors.red}[ERROR]${colors.reset} ${msg}`),
  title: (msg) => console.log(`\n${colors.bright}${colors.magenta}${msg}${colors.reset}`),
};

// 清理并退出
function cleanup() {
  console.log('\n');
  log.info('正在关闭所有服务...');
  processes.forEach(proc => {
    if (proc && !proc.killed) {
      proc.kill('SIGTERM');
    }
  });
  log.success('已退出');
  process.exit(0);
}

// 注册退出处理
process.on('SIGINT', cleanup);
process.on('SIGTERM', cleanup);

// 检查命令是否存在
function commandExists(cmd) {
  try {
    execSync(`${isWindows ? 'where' : 'which'} ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

// 获取系统 Python 命令
function getSystemPython() {
  const candidates = isWindows
    ? ['python', 'python3', 'py']
    : ['python3', 'python'];

  for (const cmd of candidates) {
    if (commandExists(cmd)) {
      return cmd;
    }
  }
  return null;
}

// 系统 Python 命令
const SYSTEM_PYTHON = getSystemPython();

// 检查 venv 是否存在
function venvExists() {
  return existsSync(VENV.python);
}

// 检查 Python 依赖是否已安装
function checkPythonDeps() {
  if (!venvExists()) return false;
  try {
    execSync(`"${VENV.python}" -c "import fastapi, uvicorn"`, {
      stdio: 'ignore',
      shell: true,
    });
    return true;
  } catch {
    return false;
  }
}

// 检查前端依赖是否已安装
function checkFrontendDeps() {
  if (!existsSync(CONFIG.webuiDir)) return null;
  return existsSync(join(CONFIG.webuiDir, 'node_modules'));
}

// 获取依赖状态
function getDepsStatus() {
  return {
    venv: venvExists(),
    python: checkPythonDeps(),
    frontend: checkFrontendDeps(),
  };
}

// 查找占用端口的进程 PID
function findPidByPort(port) {
  try {
    if (isWindows) {
      const output = execSync(`netstat -ano | findstr :${port} | findstr LISTENING`, {
        encoding: 'utf-8',
        shell: true,
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      const pids = new Set();
      for (const line of output.trim().split('\n')) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== '0') pids.add(pid);
      }
      return [...pids];
    } else {
      const output = execSync(`lsof -ti :${port}`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      return output.trim().split('\n').filter(Boolean);
    }
  } catch {
    return [];
  }
}

// 获取运行中的服务状态
function getRunningStatus() {
  const backendPids = findPidByPort(CONFIG.backendPort);
  const frontendPids = findPidByPort(CONFIG.frontendPort);
  return {
    backend: backendPids,
    frontend: frontendPids,
    isRunning: backendPids.length > 0 || frontendPids.length > 0,
  };
}

// 停止服务
async function stopServices() {
  const running = getRunningStatus();

  if (!running.isRunning) {
    log.warn('没有检测到正在运行的服务');
    return;
  }

  log.title('========== 停止服务 ==========');

  const killProcess = async (pid) => {
    try {
      if (isWindows) {
        try {
          execSync(`taskkill /PID ${pid}`, { stdio: 'ignore', shell: true });
        } catch {
          execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore', shell: true });
        }
      } else {
        execSync(`kill -15 ${pid}`, { stdio: 'ignore' });
        await new Promise(r => setTimeout(r, 500));
        try {
          execSync(`kill -0 ${pid}`, { stdio: 'ignore' });
          execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
        } catch { /* 进程已退出 */ }
      }
    } catch { /* 进程可能已退出 */ }
  };

  if (running.backend.length > 0) {
    log.info(`停止后端服务 (端口 ${CONFIG.backendPort}, PID: ${running.backend.join(', ')})...`);
    for (const pid of running.backend) {
      await killProcess(pid);
    }
    log.success('后端服务已停止');
  }

  if (running.frontend.length > 0) {
    log.info(`停止前端服务 (端口 ${CONFIG.frontendPort}, PID: ${running.frontend.join(', ')})...`);
    for (const pid of running.frontend) {
      await killProcess(pid);
    }
    log.success('前端服务已停止');
  }
}

// 创建 venv
async function createVenv() {
  if (venvExists()) {
    log.info('虚拟环境已存在');
    return true;
  }

  if (!SYSTEM_PYTHON) {
    throw new Error('未找到 Python，请先安装 Python');
  }

  log.info('创建 Python 虚拟环境...');
  return new Promise((resolve, reject) => {
    const proc = spawn(SYSTEM_PYTHON, ['-m', 'venv', CONFIG.venvDir], {
      cwd: __dirname,
      stdio: 'inherit',
      shell: true,
    });
    proc.on('close', code => {
      if (code === 0) {
        log.success('虚拟环境创建成功');
        resolve(true);
      } else {
        reject(new Error('虚拟环境创建失败'));
      }
    });
  });
}

// 确保 venv 存在
async function ensureVenv() {
  if (!venvExists()) {
    await createVenv();
  }
}

// 确保 Python 依赖已安装
async function ensurePythonDeps() {
  await ensureVenv();
  if (!checkPythonDeps()) {
    log.warn('检测到 Python 依赖未安装，正在安装...');
    await installPythonDeps();
  }
}

// 确保前端依赖已安装
async function ensureFrontendDeps() {
  if (checkFrontendDeps() === false) {
    log.warn('检测到前端依赖未安装，正在安装...');
    await installFrontendDeps();
  }
}

// 安装 Python 依赖
async function installPythonDeps() {
  await ensureVenv();
  log.info('安装 Python 依赖...');
  return new Promise((resolve, reject) => {
    const proc = spawn(VENV.pip, ['install', '-r', 'requirements.txt'], {
      cwd: __dirname,
      stdio: 'inherit',
      shell: true,
    });
    proc.on('close', code => code === 0 ? resolve() : reject(new Error('Python 依赖安装失败')));
  });
}

// 安装前端依赖
async function installFrontendDeps() {
  if (!existsSync(CONFIG.webuiDir)) {
    log.warn('webui 目录不存在，跳过前端依赖安装');
    return;
  }
  log.info('安装前端依赖...');
  return new Promise((resolve, reject) => {
    const proc = spawn('npm', ['install'], {
      cwd: CONFIG.webuiDir,
      stdio: 'inherit',
      shell: true,
    });
    proc.on('close', code => code === 0 ? resolve() : reject(new Error('前端依赖安装失败')));
  });
}

// 安装所有依赖
async function installAll() {
  log.title('========== 安装依赖 ==========');
  try {
    await installPythonDeps();
    log.success('Python 依赖安装完成');
    await installFrontendDeps();
    log.success('前端依赖安装完成');
    log.success('所有依赖安装完成！');
  } catch (e) {
    log.error(e.message);
  }
}

// 启动后端
async function startBackend(devMode = true) {
  await ensurePythonDeps();

  log.info(`启动后端服务... http://localhost:${CONFIG.backendPort}`);

  const args = [
    '-m', 'uvicorn',
    'app:app',
    '--host', CONFIG.host,
    '--port', String(CONFIG.backendPort),
    '--log-level', CONFIG.logLevel,
  ];

  if (devMode) {
    args.push('--reload', '--reload-dir', __dirname);
  }

  const proc = spawn(VENV.python, args, {
    cwd: __dirname,
    stdio: 'inherit',
    shell: true,
    env: {
      ...process.env,
      DS2API_ADMIN_KEY: CONFIG.adminKey,
    },
  });

  processes.push(proc);
  return proc;
}

// 启动前端
async function startFrontend() {
  if (!existsSync(CONFIG.webuiDir)) {
    log.warn('webui 目录不存在，跳过前端启动');
    return null;
  }

  await ensureFrontendDeps();

  log.info(`启动前端服务... http://localhost:${CONFIG.frontendPort}`);

  const proc = spawn('npm', ['run', 'dev'], {
    cwd: CONFIG.webuiDir,
    stdio: 'inherit',
    shell: true,
  });

  processes.push(proc);
  return proc;
}

// 构建前端
async function buildFrontend() {
  if (!existsSync(CONFIG.webuiDir)) {
    log.warn('webui 目录不存在');
    return;
  }

  log.info('构建前端...');
  return new Promise((resolve, reject) => {
    const proc = spawn('npm', ['run', 'build'], {
      cwd: CONFIG.webuiDir,
      stdio: 'inherit',
      shell: true,
    });
    proc.on('close', code => code === 0 ? resolve() : reject(new Error('前端构建失败')));
  });
}

// 显示状态信息
function showStatus() {
  console.log('\n' + '─'.repeat(50));
  log.success(`后端 API:  http://localhost:${CONFIG.backendPort}`);
  if (existsSync(CONFIG.webuiDir)) {
    log.success(`管理界面: http://localhost:${CONFIG.frontendPort}`);
  }
  console.log('─'.repeat(50));
  log.info('按 Ctrl+C 停止所有服务\n');
}

// 等待进程
function waitForProcesses() {
  return new Promise(resolve => {
    const checkInterval = setInterval(() => {
      const alive = processes.filter(p => !p.killed);
      if (alive.length === 0) {
        clearInterval(checkInterval);
        resolve();
      }
    }, 1000);
  });
}

// 交互式菜单
async function showMenu() {
  const rl = createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const question = (prompt) => new Promise(resolve => rl.question(prompt, resolve));

  console.clear();
  log.title('╔══════════════════════════════════════════╗');
  log.title('║         DS2API 启动脚本                  ║');
  log.title('╚══════════════════════════════════════════╝');

  // 获取依赖状态
  const deps = getDepsStatus();
  const running = getRunningStatus();

  const statusText = (ok) => ok ? `${colors.green}已安装${colors.reset}` : `${colors.yellow}未安装${colors.reset}`;

  console.log(`\n${colors.bright}环境状态:${colors.reset}`);
  console.log(`  Python:     ${SYSTEM_PYTHON || `${colors.red}未找到${colors.reset}`}`);
  console.log(`  虚拟环境:   ${deps.venv ? `${colors.green}已创建${colors.reset}` : `${colors.yellow}未创建${colors.reset}`} (${CONFIG.venvDir})`);
  console.log(`  后端依赖:   ${statusText(deps.python)}`);
  if (deps.frontend !== null) {
    console.log(`  前端依赖:   ${statusText(deps.frontend)}`);
  }

  console.log(`\n${colors.bright}服务状态:${colors.reset}`);
  console.log(`  后端 (${CONFIG.backendPort}): ${running.backend.length > 0 ? `${colors.green}运行中${colors.reset} (PID: ${running.backend.join(', ')})` : `${colors.dim}未运行${colors.reset}`}`);
  console.log(`  前端 (${CONFIG.frontendPort}): ${running.frontend.length > 0 ? `${colors.green}运行中${colors.reset} (PID: ${running.frontend.join(', ')})` : `${colors.dim}未运行${colors.reset}`}`);

  console.log(`\n${colors.bright}环境变量:${colors.reset}`);
  console.log(`  DS2API_ADMIN_KEY: ${colors.cyan}${CONFIG.adminKey}${colors.reset}`);
  console.log(`  PORT:             ${colors.cyan}${CONFIG.backendPort}${colors.reset}`);
  console.log(`  HOST:             ${colors.cyan}${CONFIG.host}${colors.reset}`);
  console.log(`  LOG_LEVEL:        ${colors.cyan}${CONFIG.logLevel}${colors.reset}`);
  console.log(`${colors.dim}  自定义: DS2API_ADMIN_KEY=你的密钥 node start.mjs${colors.reset}`);

  console.log(`
${colors.bright}请选择操作:${colors.reset}

  ${colors.cyan}1.${colors.reset} 开发模式 (后端 + 前端热重载)
  ${colors.cyan}2.${colors.reset} 仅启动后端 (开发模式)
  ${colors.cyan}3.${colors.reset} 仅启动前端
  ${colors.cyan}4.${colors.reset} 生产模式 (仅后端，无热重载)
  ${colors.cyan}5.${colors.reset} 构建前端
  ${colors.cyan}6.${colors.reset} 安装依赖 (创建venv + 安装包)
  ${colors.red}7.${colors.reset} 停止所有服务
  ${colors.cyan}0.${colors.reset} 退出
`);

  const choice = await question(`${colors.yellow}请输入选项 [1]: ${colors.reset}`);
  rl.close();

  switch (choice.trim() || '1') {
    case '1':
      log.title('========== 开发模式 ==========');
      await startBackend(true);
      await new Promise(r => setTimeout(r, 1500));
      await startFrontend();
      showStatus();
      await waitForProcesses();
      break;

    case '2':
      log.title('========== 仅后端 (开发模式) ==========');
      await startBackend(true);
      showStatus();
      await waitForProcesses();
      break;

    case '3':
      log.title('========== 仅前端 ==========');
      await startFrontend();
      showStatus();
      await waitForProcesses();
      break;

    case '4':
      log.title('========== 生产模式 ==========');
      await startBackend(false);
      showStatus();
      await waitForProcesses();
      break;

    case '5':
      await buildFrontend();
      log.success('前端构建完成！');
      break;

    case '6':
      await installAll();
      break;

    case '7':
      await stopServices();
      break;

    case '0':
      log.info('再见！');
      process.exit(0);
      break;

    default:
      log.warn('无效选项');
      await showMenu();
  }
}

// 命令行参数处理
async function main() {
  const args = process.argv.slice(2);
  const cmd = args[0];

  // 检查必要工具
  if (!SYSTEM_PYTHON) {
    log.error('未找到 Python，请先安装 Python (尝试了 python, python3, py)');
    process.exit(1);
  }

  switch (cmd) {
    case 'dev':
      log.title('========== 开发模式 ==========');
      await startBackend(true);
      await new Promise(r => setTimeout(r, 1500));
      await startFrontend();
      showStatus();
      await waitForProcesses();
      break;

    case 'prod':
      log.title('========== 生产模式 ==========');
      await startBackend(false);
      showStatus();
      await waitForProcesses();
      break;

    case 'build':
      await buildFrontend();
      log.success('前端构建完成！');
      break;

    case 'install':
      await installAll();
      break;

    case 'stop':
      await stopServices();
      break;

    case 'status':
      const status = getRunningStatus();
      console.log(`\n${colors.bright}服务状态:${colors.reset}`);
      console.log(`  后端 (${CONFIG.backendPort}): ${status.backend.length > 0 ? `${colors.green}运行中${colors.reset} (PID: ${status.backend.join(', ')})` : `${colors.dim}未运行${colors.reset}`}`);
      console.log(`  前端 (${CONFIG.frontendPort}): ${status.frontend.length > 0 ? `${colors.green}运行中${colors.reset} (PID: ${status.frontend.join(', ')})` : `${colors.dim}未运行${colors.reset}`}\n`);
      break;

    case 'help':
    case '-h':
    case '--help':
      console.log(`
${colors.bright}DS2API 启动脚本${colors.reset}

${colors.cyan}使用方法:${colors.reset}
  node start.mjs              显示交互式菜单
  node start.mjs dev          开发模式 (后端 + 前端)
  node start.mjs prod         生产模式 (无热重载)
  node start.mjs build        构建前端
  node start.mjs install      安装所有依赖 (自动创建venv)
  node start.mjs stop         停止所有服务
  node start.mjs status       查看服务状态

${colors.cyan}环境变量:${colors.reset}
  PORT        后端端口 (默认: 5001)
  HOST        监听地址 (默认: 0.0.0.0)
  LOG_LEVEL   日志级别 (默认: info)

${colors.cyan}虚拟环境:${colors.reset}
  默认路径: .venv/
  首次运行 install 时自动创建
`);
      break;

    default:
      await showMenu();
  }
}

main().catch(e => {
  log.error(e.message);
  process.exit(1);
});
