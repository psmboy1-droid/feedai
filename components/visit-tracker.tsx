'use client';

import { useEffect } from 'react';

function getTodayKst(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

export function VisitTracker() {
  useEffect(() => {
    // 1. 프로덕션 환경 체크
    if (process.env.NODE_ENV !== 'production') return;
    if (typeof window === 'undefined') return;

    // 2. 로컬호스트 접속 제외
    const hostname = window.location.hostname;
    if (hostname === 'localhost' || hostname === '127.0.0.1') return;

    // 3. 헤드리스 브라우저/자동화 툴 차단
    if (navigator.webdriver) return;

    // 4. 오늘 KST 날짜 기준 브라우저 로컬스토리지 1일 1회 체크
    const todayKst = getTodayKst();
    if (localStorage.getItem('feedai_visited_date') === todayKst) return;

    // 5. 방문 기록 API 호출
    fetch('/api/visit', {
      method: 'POST',
      credentials: 'same-origin',
    })
      .then((res) => {
        if (res.ok) {
          localStorage.setItem('feedai_visited_date', todayKst);
        }
      })
      .catch(() => {
        // 네트워크 또는 일시적 오류 무시
      });
  }, []);

  return null;
}

export default VisitTracker;
