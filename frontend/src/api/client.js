// API client — API_BASE จาก .env (REACT_APP_API_BASE)
export const API_BASE = process.env.REACT_APP_API_BASE || 'http://localhost:5000/api';
// export const API_BASE = '/MSE-PC-AUTO-PLAN/api';
// export const API_BASE = 'http://localhost:5000/api'

export const apiCall = async (endpoint, options = {}) => {
  const token = localStorage.getItem('token');
  const isFormData = options.body instanceof FormData;
  const config = {
    ...options,
    headers: {
      ...(isFormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token && { Authorization: `Bearer ${token}` }),
      ...options.headers,
    },
  };

  const response = await fetch(`${API_BASE}${endpoint}`, config);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = `${process.env.PUBLIC_URL || ''}/login`;
      throw new Error('Session หมดอายุ กรุณาเข้าสู่ระบบใหม่');
    }
    throw new Error(data.message || 'เกิดข้อผิดพลาด');
  }

  return data;
};

// ดาวน์โหลดไฟล์ (binary) พร้อม Bearer token — apiCall ใช้ไม่ได้เพราะมันบังคับ .json()
// เปิด blob แล้วสั่ง browser ดาวน์โหลดด้วยชื่อไฟล์เดิม
export const apiDownload = async (endpoint, filename) => {
  const token = localStorage.getItem('token');
  const response = await fetch(`${API_BASE}${endpoint}`, {
    headers: { ...(token && { Authorization: `Bearer ${token}` }) },
  });
  if (!response.ok) {
    if (response.status === 401) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = `${process.env.PUBLIC_URL || ''}/login`;
    }
    const data = await response.json().catch(() => ({}));
    throw new Error(data.message || 'ดาวน์โหลดไฟล์ไม่สำเร็จ');
  }
  const blob = await response.blob();
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename || 'download';
  document.body.appendChild(a);
  a.click();
  a.remove();
  window.URL.revokeObjectURL(url);
};

// ข้อมูล user ปัจจุบันจาก localStorage
export const getCurrentUser = () => {
  try {
    return JSON.parse(localStorage.getItem('user') || '{}');
  } catch {
    return {};
  }
};

export const isAuthenticated = () => !!localStorage.getItem('token');
