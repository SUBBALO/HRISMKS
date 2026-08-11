"""Pydantic request/response models."""
from typing import List, Optional
from pydantic import BaseModel


class LoginRequest(BaseModel):
    username: str
    password: str


class UserCreate(BaseModel):
    username: str
    password: str
    name: Optional[str] = ""
    role: Optional[str] = "hrd"
    access: Optional[dict] = None
    must_change_password: Optional[bool] = None


class UserUpdate(BaseModel):
    name: Optional[str] = None
    role: Optional[str] = None
    active: Optional[bool] = None
    password: Optional[str] = None
    access: Optional[dict] = None
