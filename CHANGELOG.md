# Changelog

## [Unreleased]

### Fixed
- แก้ไข .gitignore ที่ encode เป็น UTF-16 ทำให้ Git อ่านไม่ออก ส่งผลให้ node_modules ถูก track อยู่
- ลบ node_modules ออกจาก git index ด้วย git rm --cached

### Added
- เพิ่มไฟล์ CLAUDE.md สำหรับเก็บเอกสาร architecture และคำแนะนำการพัฒนาโปรเจกต์
- เพิ่มไฟล์ CHANGELOG.md สำหรับบันทึกการเปลี่ยนแปลง
