import { useCallback, useEffect, useRef, useState } from 'react';

// อ่านค่าจากเครื่องอ่านบัตร RFID ที่ทำตัวเป็นคีย์บอร์ด (keyboard wedge)
//
// ต่างจาก useScanInput ตรงที่ "ไม่รู้ความยาวล่วงหน้า" — UID ของบัตรแต่ละรุ่นยาวไม่เท่ากัน
// (hex 8 ตัว, ทศนิยม 10 ตัว ฯลฯ) จึงผูกกับความยาวคงที่ไม่ได้ ใช้ 2 เงื่อนไขแทน:
//   1) กด Enter — เครื่องอ่านส่วนใหญ่เคาะ Enter ท้ายค่าให้อยู่แล้ว (ทางหลัก)
//   2) หยุดพิมพ์ครบ idleMs — เผื่อเครื่องอ่านรุ่นที่ไม่ส่ง Enter
// ค่า idleMs ตั้งเผื่อไว้ยาวพอให้เครื่องอ่านพิมพ์ค่าจนจบก่อน ไม่งั้นจะยิงตั้งแต่ค่ายังมาไม่ครบ
const useCardScan = (onComplete, { idleMs = 400, minLength = 4 } = {}) => {
  const [value, setValue] = useState('');
  const timerRef = useRef(null);
  const cbRef = useRef(onComplete);

  // เก็บ callback ล่าสุดไว้ใน ref — onChange/onKeyDown จะได้ไม่เปลี่ยน reference ทุก render
  useEffect(() => {
    cbRef.current = onComplete;
  }, [onComplete]);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const fire = useCallback(
    (raw) => {
      clearTimeout(timerRef.current);
      const v = String(raw ?? '').trim();
      if (v.length >= minLength) cbRef.current(v);
    },
    [minLength]
  );

  const onChange = useCallback(
    (e) => {
      const v = e.target.value;
      setValue(v);
      clearTimeout(timerRef.current);
      if (v.trim().length >= minLength) {
        timerRef.current = setTimeout(() => fire(v), idleMs);
      }
    },
    [fire, idleMs, minLength]
  );

  const onKeyDown = useCallback(
    (e) => {
      if (e.key === 'Enter') {
        e.preventDefault(); // กันฟอร์ม submit ซ้ำกับการยิงบัตร
        fire(e.target.value);
      }
    },
    [fire]
  );

  const reset = useCallback(() => {
    clearTimeout(timerRef.current);
    setValue('');
  }, []);

  return { value, onChange, onKeyDown, reset };
};

export default useCardScan;
