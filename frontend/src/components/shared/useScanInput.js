import { useState } from 'react';

// สแกน barcode: ยิง onComplete อัตโนมัติเมื่อความยาวครบ length พอดี (พฤติกรรมหน้าจอเดิม)
// + Enter ยิงด้วยค่าที่พิมพ์ค้าง / onPartial แจ้งทุกครั้งที่ความยาวยังไม่ครบ (ใช้เคลียร์ตาราง)
// คืน props ผูกกับ <Form.Control> ได้ตรง ๆ: { value, onChange, onKeyDown } + reset()
// initialValue = ค่าตั้งต้นในช่อง (หน้า Shop Floor เติมรหัสพนักงานของคนที่ล็อกอินอยู่ให้เลย)
// reset() ยังล้างเป็นค่าว่างเสมอ เพราะเครื่องที่หน้าไลน์ใช้ร่วมกันหลายคน
const useScanInput = (length, onComplete, onPartial, initialValue = '') => {
  const [value, setValue] = useState(initialValue);

  const onChange = (e) => {
    const v = e.target.value;
    setValue(v);
    if (v.length === length) onComplete(v);
    else if (onPartial) onPartial(v);
  };

  const onKeyDown = (e) => {
    if (e.key === 'Enter' && value.trim()) onComplete(value.trim());
  };

  const reset = () => setValue('');

  return { value, onChange, onKeyDown, reset };
};

export default useScanInput;
