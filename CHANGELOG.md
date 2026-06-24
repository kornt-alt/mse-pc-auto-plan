# Changelog

## [Unreleased]

### Changed
- อัปเดต README.md เพิ่มคำอธิบาย Git Workflow สำหรับทีม (สร้าง branch, อัปเดตโค้ดจาก main, merge กลับ)

### Added
- เพิ่ม `GET /api/userall` endpoint สำหรับดึงรายชื่อ user ทั้งหมด (ADMIN only)

### Changed
- เปลี่ยน database จาก Microsoft SQL Server เป็น MariaDB โดยใช้ `mysql2` แทน `mssql`
- เปลี่ยน query syntax จาก named parameter (`@param`) เป็น positional `?` ของ mysql2
- เปลี่ยน `GETDATE()` เป็น `NOW()`
- แยก multi-statement query ใน PATCH /api/user ออกเป็น 2 query แยกกัน

### Added
- เพิ่ม `backend/sql/init_users.sql` สำหรับสร้าง table Users และ logs บน MariaDB

### Fixed
- แก้ไข .gitignore ที่ encode เป็น UTF-16 ทำให้ Git อ่านไม่ออก ส่งผลให้ node_modules ถูก track อยู่
- ลบ node_modules ออกจาก git index ด้วย git rm --cached

### Added
- เพิ่มไฟล์ CLAUDE.md สำหรับเก็บเอกสาร architecture และคำแนะนำการพัฒนาโปรเจกต์
- เพิ่มไฟล์ CHANGELOG.md สำหรับบันทึกการเปลี่ยนแปลง
