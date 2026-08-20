// CalendarHorizonAlert — เตือน "ปฏิทินใกล้หมด" ก่อนงานจะเริ่มหลุดแผน
//
// ทำไมต้องมี: ปฏิทินหมดอายุเงียบ ๆ ถ้าไม่มีใคร generate เพิ่ม งานจะทยอยวางไม่ลง
// และสัญญาณเดียวที่เคยมีคือ capacity_warning ซึ่ง **เห็นก็ต่อเมื่อมีงานหลุดไปแล้ว** = สายไปแล้ว
//
// ⚠️ ตัวเลขทั้งหมดมาจาก GET /system/calendar-horizon — **ห้ามคำนวณวันที่เองด้วย new Date()**
// วันของโรงงานมาจาก nowBangkok() ฝั่ง server ที่เดียว (เป็นสวิตช์มือ) ถ้า UI คิดเองจะกลายเป็น
// นาฬิกาตัวที่สองที่เพี้ยนจากกันได้โดยไม่มีอะไรฟ้อง
//
// horizonAlert() เป็น pure — ทดสอบใน __tests__/CalendarHorizonAlert.test.js
import React from 'react';
import { Alert, Button } from 'react-bootstrap';

// level มาจาก backend (utils/calendarHorizon.js) — ที่นี่แปลงเป็นสี/ข้อความเท่านั้น
// 'ok' คือกรณีเดียวที่เงียบ · null = ไม่ต้องวาดอะไร
export function horizonAlert(h) {
  if (!h || h.level === 'ok') return null;
  const last = h.last_date || '-';
  const left = h.days_left;

  if (h.level === 'none') {
    return {
      variant: 'danger',
      icon: 'bi-calendar-x-fill',
      title: 'ยังไม่มีปฏิทินการผลิต',
      text: 'ระบบวางแผนไม่ได้เลยจนกว่าจะสร้างปฏิทิน',
    };
  }
  if (h.level === 'expired') {
    return {
      variant: 'danger',
      icon: 'bi-calendar-x-fill',
      title: `ปฏิทินหมดไปแล้ว ${Math.abs(left)} วัน`,
      text: `วันสุดท้ายคือ ${last} — Replan ตอนนี้งานจะหลุดแผนทั้งหมด ต้องสร้างปฏิทินเพิ่มก่อน`,
    };
  }
  if (h.level === 'critical') {
    return {
      variant: 'danger',
      icon: 'bi-calendar-x-fill',
      title: left === 0 ? 'ปฏิทินหมดวันนี้' : `ปฏิทินเหลืออีก ${left} วัน`,
      text: `มีถึง ${last} เท่านั้น — สร้างเพิ่มก่อน ไม่งั้นงานที่วางแผนใหม่จะเริ่มหลุด`,
    };
  }
  return {
    variant: 'warning',
    icon: 'bi-calendar-week',
    title: `ปฏิทินเหลืออีก ${left} วัน`,
    text: `มีถึง ${last} — ควรสร้างเพิ่มไว้ก่อนที่งานจะเริ่มวางไม่ลง`,
  };
}

const CalendarHorizonAlert = ({ horizon, onGoToCalendar }) => {
  const a = horizonAlert(horizon);
  if (!a) return null;

  return (
    <Alert variant={a.variant} className="py-2 d-flex flex-wrap align-items-center gap-2 mb-3">
      <i className={`bi ${a.icon}`} aria-hidden="true" />
      <strong>{a.title}</strong>
      <span className="small">{a.text}</span>
      {onGoToCalendar && (
        <Button variant="link" size="sm" className="p-0 ms-auto text-decoration-none" onClick={onGoToCalendar}>
          ไปหน้าปฏิทิน
        </Button>
      )}
    </Alert>
  );
};

export default CalendarHorizonAlert;
