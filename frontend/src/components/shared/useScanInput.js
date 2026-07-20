import { useState } from 'react';

// สแกน barcode: ยิง onComplete อัตโนมัติเมื่อความยาวครบ length พอดี (พฤติกรรมหน้าจอเดิม)
// + Enter ยิงด้วยค่าที่พิมพ์ค้าง / onPartial แจ้งทุกครั้งที่ความยาวยังไม่ครบ (ใช้เคลียร์ตาราง)
// คืน props ผูกกับ <Form.Control> ได้ตรง ๆ: { value, onChange, onKeyDown } + reset()
const useScanInput = (length, onComplete, onPartial) => {
  const [value, setValue] = useState('');

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
