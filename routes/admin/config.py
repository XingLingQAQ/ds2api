# -*- coding: utf-8 -*-
"""Admin 配置管理模块 - 配置、API Keys、账号管理"""
import os

from fastapi import APIRouter, HTTPException, Request, Depends
from fastapi.responses import JSONResponse

from core.config import CONFIG, save_config, logger
from core.auth import init_account_queue, get_queue_status, get_account_identifier
from core.deepseek import login_deepseek_via_account

from .auth import verify_admin

router = APIRouter()

# Vercel 预配置
VERCEL_TOKEN = os.getenv("VERCEL_TOKEN", "")
VERCEL_PROJECT_ID = os.getenv("VERCEL_PROJECT_ID", "")
VERCEL_TEAM_ID = os.getenv("VERCEL_TEAM_ID", "")


# ----------------------------------------------------------------------
# Vercel 预配置信息
# ----------------------------------------------------------------------
@router.get("/vercel/config")
async def get_vercel_config(_: bool = Depends(verify_admin)):
    """获取预配置的 Vercel 信息（脱敏）"""
    return JSONResponse(content={
        "has_token": bool(VERCEL_TOKEN),
        "project_id": VERCEL_PROJECT_ID,
        "team_id": VERCEL_TEAM_ID or None,
    })


# ----------------------------------------------------------------------
# 配置管理
# ----------------------------------------------------------------------
@router.get("/config")
async def get_config(_: bool = Depends(verify_admin)):
    """获取当前配置（密码脱敏）"""
    safe_config = {
        "keys": CONFIG.get("keys", []),
        "accounts": [],
        "claude_mapping": CONFIG.get("claude_mapping", {}),
    }
    
    for acc in CONFIG.get("accounts", []):
        safe_acc = {
            "email": acc.get("email", ""),
            "mobile": acc.get("mobile", ""),
            "has_password": bool(acc.get("password")),
            "has_token": bool(acc.get("token")),
            "token_preview": acc.get("token", "")[:20] + "..." if acc.get("token") else "",
        }
        safe_config["accounts"].append(safe_acc)
    
    return JSONResponse(content=safe_config)


@router.post("/config")
async def update_config(request: Request, _: bool = Depends(verify_admin)):
    """更新完整配置"""
    data = await request.json()
    
    if "keys" in data:
        CONFIG["keys"] = data["keys"]
    
    if "accounts" in data:
        # 保留原有密码和 token
        existing = {get_account_identifier(a): a for a in CONFIG.get("accounts", [])}
        for acc in data["accounts"]:
            acc_id = get_account_identifier(acc)
            if acc_id in existing:
                if not acc.get("password"):
                    acc["password"] = existing[acc_id].get("password", "")
                if not acc.get("token"):
                    acc["token"] = existing[acc_id].get("token", "")
        CONFIG["accounts"] = data["accounts"]
        init_account_queue()
    
    if "claude_mapping" in data:
        CONFIG["claude_mapping"] = data["claude_mapping"]
    
    save_config(CONFIG)
    return JSONResponse(content={"success": True, "message": "配置已更新"})


# ----------------------------------------------------------------------
# API Keys 管理
# ----------------------------------------------------------------------
@router.post("/keys")
async def add_key(request: Request, _: bool = Depends(verify_admin)):
    """添加 API Key"""
    data = await request.json()
    key = data.get("key", "").strip()
    
    if not key:
        raise HTTPException(status_code=400, detail="Key 不能为空")
    
    if key in CONFIG.get("keys", []):
        raise HTTPException(status_code=400, detail="Key 已存在")
    
    if "keys" not in CONFIG:
        CONFIG["keys"] = []
    CONFIG["keys"].append(key)
    save_config(CONFIG)
    
    return JSONResponse(content={"success": True, "total_keys": len(CONFIG["keys"])})


@router.delete("/keys/{key}")
async def delete_key(key: str, _: bool = Depends(verify_admin)):
    """删除 API Key"""
    if key not in CONFIG.get("keys", []):
        raise HTTPException(status_code=404, detail="Key 不存在")
    
    CONFIG["keys"].remove(key)
    save_config(CONFIG)
    return JSONResponse(content={"success": True, "total_keys": len(CONFIG["keys"])})


# ----------------------------------------------------------------------
# 账号管理
# ----------------------------------------------------------------------
@router.get("/accounts")
async def list_accounts(
    page: int = 1,
    page_size: int = 10,
    _: bool = Depends(verify_admin)
):
    """获取账号列表（分页，倒序，密码脱敏）"""
    accounts = CONFIG.get("accounts", [])
    total = len(accounts)

    # 倒序排列
    accounts = list(reversed(accounts))

    # 计算分页
    page = max(1, page)
    page_size = max(1, min(100, page_size))  # 限制每页最多 100 条
    total_pages = (total + page_size - 1) // page_size if total > 0 else 1

    start = (page - 1) * page_size
    end = start + page_size
    page_accounts = accounts[start:end]

    # 脱敏处理
    safe_accounts = []
    for acc in page_accounts:
        safe_acc = {
            "email": acc.get("email", ""),
            "mobile": acc.get("mobile", ""),
            "has_password": bool(acc.get("password")),
            "has_token": bool(acc.get("token")),
            "token_preview": acc.get("token", "")[:20] + "..." if acc.get("token") else "",
        }
        safe_accounts.append(safe_acc)

    return JSONResponse(content={
        "items": safe_accounts,
        "total": total,
        "page": page,
        "page_size": page_size,
        "total_pages": total_pages,
    })


@router.post("/accounts")
async def add_account(request: Request, _: bool = Depends(verify_admin)):
    """添加账号"""
    data = await request.json()
    email = data.get("email", "").strip()
    mobile = data.get("mobile", "").strip()
    password = data.get("password", "").strip()
    token = data.get("token", "").strip()
    
    if not email and not mobile:
        raise HTTPException(status_code=400, detail="需要 email 或 mobile")
    
    # 检查是否已存在
    for acc in CONFIG.get("accounts", []):
        if email and acc.get("email") == email:
            raise HTTPException(status_code=400, detail="邮箱已存在")
        if mobile and acc.get("mobile") == mobile:
            raise HTTPException(status_code=400, detail="手机号已存在")
    
    new_account = {}
    if email:
        new_account["email"] = email
    if mobile:
        new_account["mobile"] = mobile
    if password:
        new_account["password"] = password
    if token:
        new_account["token"] = token
    
    if "accounts" not in CONFIG:
        CONFIG["accounts"] = []
    CONFIG["accounts"].append(new_account)
    init_account_queue()
    save_config(CONFIG)
    
    return JSONResponse(content={"success": True, "total_accounts": len(CONFIG["accounts"])})


@router.delete("/accounts/{identifier}")
async def delete_account(identifier: str, _: bool = Depends(verify_admin)):
    """删除账号（通过 email 或 mobile）"""
    accounts = CONFIG.get("accounts", [])
    for i, acc in enumerate(accounts):
        if acc.get("email") == identifier or acc.get("mobile") == identifier:
            accounts.pop(i)
            init_account_queue()
            save_config(CONFIG)
            return JSONResponse(content={"success": True, "total_accounts": len(accounts)})
    
    raise HTTPException(status_code=404, detail="账号不存在")


# ----------------------------------------------------------------------
# 账号队列状态
# ----------------------------------------------------------------------
@router.get("/queue/status")
async def get_account_queue_status(_: bool = Depends(verify_admin)):
    """获取账号轮询队列状态"""
    return JSONResponse(content=get_queue_status())
