// แทน static cache ของ Flutter (DashboardScreen.cachedPlanData/cachedReportData/
// cachedPrevReportData) — semantics before/after เดิม: ข้อมูล report ใหม่ที่ "ไม่เหมือน"
// ของเดิม จะดันของเดิมไปเป็น previous ก่อนทับ
import React, { createContext, useContext, useState, useCallback, useRef } from 'react';
import { apiCall } from '../api/client';

const PlanDataContext = createContext(null);

export const PlanDataProvider = ({ children }) => {
  const [planData, setPlanData] = useState(null); // null = ยังไม่เคยโหลด
  const [reportData, setReportData] = useState([]);
  const [prevReportData, setPrevReportData] = useState([]);
  const [loading, setLoading] = useState(false);
  const loadingRef = useRef(false);

  // หลังกด Initial Plan / Replan (dashboard_screen.dart L36-56)
  const setFromRunResponse = useCallback((data, report) => {
    setPlanData(data ?? []);
    setReportData((prev) => {
      const next = report ?? [];
      if (prev.length > 0 && JSON.stringify(prev) !== JSON.stringify(next)) {
        setPrevReportData(prev);
      }
      return next;
    });
  }, []);

  // กู้คืนหลัง refresh (dashboard_screen.dart L76-118) — เรียกเฉพาะตอนยังไม่มีข้อมูล
  const loadLatest = useCallback(async () => {
    if (loadingRef.current) return;
    loadingRef.current = true;
    setLoading(true);
    try {
      const decoded = await apiCall('/schedule/latest');
      setReportData((prev) => {
        if (prev.length > 0) setPrevReportData(prev);
        return decoded.report ?? [];
      });
      setPlanData(decoded.data ?? []);
    } catch (e) {
      console.error('กู้คืนข้อมูลแผนล้มเหลว:', e);
      setPlanData([]); // กันวนโหลดซ้ำ
    } finally {
      loadingRef.current = false;
      setLoading(false);
    }
  }, []);

  return (
    <PlanDataContext.Provider
      value={{ planData, reportData, prevReportData, loading, setFromRunResponse, loadLatest }}
    >
      {children}
    </PlanDataContext.Provider>
  );
};

export const usePlanData = () => {
  const ctx = useContext(PlanDataContext);
  if (!ctx) throw new Error('usePlanData ต้องใช้ภายใน <PlanDataProvider>');
  return ctx;
};
