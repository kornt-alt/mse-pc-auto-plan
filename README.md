# MSE Auto Plainning

ระบบจัดการการผลิตอัตโนมัติ

---

## สิ่งที่ต้องติดตั้งก่อน (Prerequisites)

| โปรแกรม | เวอร์ชันแนะนำ | ดาวน์โหลด |
|---------|--------------|-----------|
| Node.js | 18 ขึ้นไป | https://nodejs.org |
| MariaDB | 10.6 ขึ้นไป | https://mariadb.org/download |
| Git | ล่าสุด | https://git-scm.com |

---

## ขั้นตอนติดตั้งครั้งแรก (First-time Setup)

### 1. Clone โปรเจกต์ลงเครื่อง

```bash
git clone https://github.com/kornt-alt/mse-pc-auto-plan
```

> ถ้ายังไม่มี Git ให้ติดตั้งก่อน แล้วรันคำสั่งนี้ใน Terminal (Command Prompt / PowerShell / Git Bash)


---

### 2. ตั้งค่า Environment ของ Backend

คัดลอกไฟล์ตัวอย่างแล้วแก้ค่าให้ตรงกับเครื่องตัวเอง:

```bash
cd backend
copy .env.example .env
```

เปิดไฟล์ `backend/.env` แล้วแก้ไข:

```env
DB_HOST=localhost
DB_USER=root
DB_PASS=รหัสผ่าน MariaDB ของคุณ
DB_NAME=SMART-STORE-PE
DB_PORT=3306
PORT=5000
JWT_SECRET=เปลี่ยนเป็นข้อความลับอะไรก็ได้
```

---

### 3. ติดตั้ง Dependencies

**Backend:**
```bash
cd backend
npm install
```

**Frontend:**
```bash
cd frontend
npm install
```

---

### 4. รันระบบในโหมด Development

เปิด Terminal **2 หน้าต่าง** พร้อมกัน:

**หน้าต่างที่ 1 — Backend:**
```bash
cd backend
node index.js
```

**หน้าต่างที่ 2 — Frontend:**
```bash
cd frontend
npm start
```

---

## Deploy (Production)

Build frontend แล้วให้ backend เสิร์ฟ:

```bash
# Build frontend
cd frontend
npm run build

# คัดลอก build ไปที่ backend
xcopy /E /I /Y build ..\backend\build

# รัน backend
cd ..\backend
node index.js
```

---

## Git Workflow (การทำงานเป็นทีม)

**หลักการ:** ห้าม push ตรงเข้า `main` — ให้สร้าง branch แยกต่างหากทุกครั้ง แล้วค่อย merge กลับ

---

### เริ่มงานใหม่ — สร้าง Branch

```bash
# 1. ดึงโค้ดล่าสุดของ main ก่อนเสมอ
git checkout main
git pull origin main

# 2. สร้าง branch ใหม่จาก main ที่เป็นปัจจุบัน
git checkout -b feature/ชื่อฟีเจอร์
# ตัวอย่าง:
#   git checkout -b feature/add-receive-page
#   git checkout -b fix/login-rfid-bug
```

---

### ระหว่างทำงาน — บันทึกงานใน Branch ตัวเอง

```bash
# ดูไฟล์ที่เปลี่ยนแปลง
git status

# เพิ่มไฟล์เข้า staging (ระบุชื่อไฟล์ดีกว่า git add .)
git add backend/index.js frontend/src/components/Receive.js

# Commit
git commit -m "feat: เพิ่มหน้า Receive"

# Push branch ขึ้น GitHub
git push origin feature/add-receive-page
```

---

### อัปเดตโค้ดล่าสุดจาก main เข้า Branch ตัวเอง

ทำทุกครั้งก่อนที่จะ merge หรือเมื่อ main มีการอัปเดต:

```bash
# ดึง main ล่าสุดลงมาก่อน
git fetch origin

# Merge main เข้า branch ตัวเอง
git merge origin/main
```

> ถ้ามี **Conflict** จะขึ้นบอกให้แก้ไขไฟล์ที่ขัดแย้งกัน เปิดไฟล์นั้นแล้วเลือกว่าจะเก็บโค้ดฝั่งไหน จากนั้น `git add <ไฟล์>` แล้ว `git merge --continue`

---

### เสร็จงาน — Merge กลับเข้า main

```bash
# สลับไปที่ main
git checkout main

# ดึงโค้ดล่าสุดอีกครั้ง (กันคนอื่น push มาในระหว่างที่ทำงาน)
git pull origin main

# Merge branch ของตัวเองเข้า main
git merge feature/add-receive-page

# Push main ขึ้น GitHub
git push origin main

# ลบ branch ที่ merge แล้ว (ไม่บังคับ แต่ช่วยให้ repo สะอาด)
git branch -d feature/add-receive-page
git push origin --delete feature/add-receive-page
```

---

### ดู Branch ทั้งหมด

```bash
# branch ในเครื่อง
git branch

# branch ทั้งหมด (รวม remote)
git branch -a
```

---

### ตัวอย่างชื่อ Branch และ Commit ที่ดี

| ประเภท | ชื่อ Branch | Commit Message |
|--------|------------|----------------|
| ฟีเจอร์ใหม่ | `feature/add-receive-page` | `feat: เพิ่มหน้า Receive` |
| แก้บัก | `fix/login-rfid-bug` | `fix: แก้ไขบัก login ด้วย RFID` |
| ปรับ UI | `update/storage-ui` | `update: ปรับ UI หน้าคลังสินค้า` |

---

## ปัญหาที่พบบ่อย

**`Cannot find module 'dotenv'` หรือ error อื่น ๆ ตอนรัน backend**
→ ลองรัน `npm install` ใน folder `backend/` อีกครั้ง

**หน้าเว็บเปิดแล้วขึ้น "Cannot connect to database"**
→ ตรวจสอบ `backend/.env` ว่า `DB_USER`, `DB_PASS` ถูกต้อง และ MariaDB รันอยู่

**`git push` แล้วขึ้น Permission denied**
→ ต้องมีสิทธิ์เข้า repository หรือตั้งค่า SSH key ก่อน ติดต่อเจ้าของโปรเจกต์
