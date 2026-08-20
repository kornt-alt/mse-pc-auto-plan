import React from 'react';
import { Button } from 'react-bootstrap';

// ErrorBoundary — กันหน้าจอขาวทั้งแอปเมื่อ component ไหนสักตัว render พัง
//
// ทำไมต้องมี: React 16+ ถ้า error หลุดออกมาตอน render แล้วไม่มีใครดัก มัน unmount ทั้ง tree ทิ้ง
// ผลคือ**จอขาวเปล่า ๆ ไม่มีข้อความอะไรเลย** กระทบหนักสุดที่หน้า Shop Floor เพราะพนักงานหน้าไลน์
// ไม่มีทางรู้ว่าเกิดอะไรขึ้นหรือต้องทำยังไงต่อ และเราก็ไม่ได้อะไรกลับมาสักอย่าง
//
// ข้อจำกัดของ ErrorBoundary (อย่าคาดหวังเกินนี้): ดักได้เฉพาะ error ตอน render / lifecycle / constructor
// ของลูก ๆ เท่านั้น — **ไม่ดัก** error ใน event handler, ใน setTimeout, ใน async/promise
// (พวกนั้น apiCall + ToastHost รับไปแล้ว) และไม่ดัก error ของตัวมันเอง
//
// ต้องเป็น class component — React ยังไม่มี hook สำหรับ error boundary
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    // เครื่อง client ไม่มีที่ส่ง log กลับ — อย่างน้อยให้เปิด DevTools แล้วเห็นของจริง
    console.error('UI error:', error, info?.componentStack);
  }

  handleReload = () => {
    window.location.reload();
  };

  handleHome = () => {
    // ใช้ href ไม่ใช่ navigate: ตอนนี้ React tree พังไปแล้ว router อาจใช้การไม่ได้
    // PUBLIC_URL = basename ของแอป (/MSE-PC-AUTO-PLAN) — โหลดใหม่ทั้งหน้าจึงกลับมาสะอาดแน่นอน
    window.location.href = `${process.env.PUBLIC_URL || ''}/`;
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div className="container py-5">
        <div className="empty-state">
          <i className="bi bi-exclamation-octagon" aria-hidden="true" />
          <h2 className="h4 mb-2">หน้านี้แสดงผลไม่สำเร็จ</h2>
          <p className="mb-1">
            เกิดข้อผิดพลาดในการแสดงผล ข้อมูลที่บันทึกไว้แล้วไม่ได้หายไปไหน
          </p>
          <p className="mb-4">
            กด &quot;โหลดหน้าใหม่&quot; เพื่อลองอีกครั้ง ถ้ายังเป็นซ้ำ กรุณาแจ้งผู้ดูแลระบบ
          </p>

          <div className="d-flex gap-2 justify-content-center flex-wrap">
            <Button className="btn-mse touch-target" onClick={this.handleReload}>
              <i className="bi bi-arrow-clockwise me-2" aria-hidden="true" />
              โหลดหน้าใหม่
            </Button>
            <Button variant="outline-secondary" className="touch-target" onClick={this.handleHome}>
              <i className="bi bi-house me-2" aria-hidden="true" />
              กลับหน้าแรก
            </Button>
          </div>

          {/* รายละเอียดทางเทคนิคซ่อนไว้ใน <details> — ผู้ใช้ทั่วไปไม่ต้องเห็น
              แต่ตอนโทรแจ้งปัญหาจะอ่านให้ผู้ดูแลฟังได้ ไม่ต้องสอนให้เปิด DevTools */}
          <details className="mt-4 text-start mx-auto" style={{ maxWidth: '40rem' }}>
            <summary className="small">รายละเอียดสำหรับผู้ดูแลระบบ</summary>
            <pre className="small mt-2 p-2 border rounded" style={{ whiteSpace: 'pre-wrap' }}>
              {String(this.state.error?.message || this.state.error)}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
