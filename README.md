# Purchase Chemical Request

ระบบร้องขอและจัดการสารเคมี

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
git clone https://github.com/kornt-alt/mecha-ps-chemical-system
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

## Git Workflow (สำหรับ Dev ใหม่)

### ดึงโค้ดล่าสุดจาก GitHub

```bash
git pull origin main
```

> รันก่อนเริ่มทำงานทุกครั้ง เพื่อให้โค้ดเป็นเวอร์ชันล่าสุด

### บันทึกงานและ Push ขึ้น GitHub

```bash
# 1. ดูว่าแก้ไขไฟล์อะไรไปบ้าง
git status

# 2. เพิ่มไฟล์ที่แก้ไขเข้า staging
git add .

# 3. Commit พร้อมข้อความอธิบาย
git commit -m "feat: เพิ่มฟีเจอร์ X"

# 4. Push ขึ้น GitHub
git push origin main
```

### ตัวอย่างข้อความ Commit ที่ดี

```
feat: เพิ่มฟังก์ชันค้นหาสินค้า
fix: แก้ไขบัก login ด้วย RFID
update: ปรับ UI หน้าคลังสินค้า
```

---

## ปัญหาที่พบบ่อย

**`Cannot find module 'dotenv'` หรือ error อื่น ๆ ตอนรัน backend**
→ ลองรัน `npm install` ใน folder `backend/` อีกครั้ง

**หน้าเว็บเปิดแล้วขึ้น "Cannot connect to database"**
→ ตรวจสอบ `backend/.env` ว่า `DB_USER`, `DB_PASS` ถูกต้อง และ MariaDB รันอยู่

**`git push` แล้วขึ้น Permission denied**
→ ต้องมีสิทธิ์เข้า repository หรือตั้งค่า SSH key ก่อน ติดต่อเจ้าของโปรเจกต์
