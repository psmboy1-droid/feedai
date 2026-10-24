"use client";

import { useState, useEffect } from 'react';
import { Rss, KeyRound, Search, FileText, Users, ArrowUpRight, Activity, UserPlus, Eye } from 'lucide-react';

const sections = [
    { href: '/admin/social', title: 'SNS 자체 수집', description: '인스타그램·X 수집 상태와 미디어 누락을 확인합니다.', Icon: Rss },
    { href: '/admin/billing', title: '결제·자동 청구', description: '토스페이먼츠 키와 정기 결제 상태를 관리합니다.', Icon: KeyRound },
    { href: '/admin/dopamine', title: '도파민 센터', description: '유튜브 RSS를 등록하고 국가·쇼츠·일반 영상 분류를 관리합니다.', Icon: Rss },
    { href: '/admin/members', title: '회원 관리', description: '회원 목록을 확인하고 이름·크레딧 잔액을 수정하거나 회원을 삭제합니다.', Icon: Users },
    { href: '/admin/prompts', title: 'AI 프롬프트 설정', description: 'Today AI 요약과 기사 AI 분석의 명령어를 확인하고 수정합니다.', Icon: FileText },
    { href: '/admin/rss', title: '공용 RSS 관리', description: '공용 피드 소스와 카테고리를 등록·수정·삭제합니다.', Icon: Rss },
    { href: '/admin/ai', title: 'AI API 설정', description: 'OpenAI API 키를 등록하고 연결 상태를 확인합니다.', Icon: KeyRound },
    { href: '/admin/seo', title: 'SEO 설정', description: '사이트 검색 정보와 공유 이미지, 검색 노출을 관리합니다.', Icon: Search }
];

export default function AdminHome() {
    const [stats, setStats] = useState({ todayVisitors: 0, totalVisits: 0, todayNewUsers: 0, totalUsers: 0 });
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        fetch('/api/admin/dashboard-stats')
            .then(res => res.json())
            .then(data => {
                setStats(data as typeof stats);
                setLoading(false);
            })
            .catch(err => {
                console.error('통계 데이터 로딩 실패:', err);
                setLoading(false);
            });
    }, []);

    return (
        <div className="admin-page">
            <header className="admin-heading">
                <div>
                    <a href="/my-feed">← 내 피드로 돌아가기</a>
                    <p className="eyebrow">ADMIN</p>
                    <h1>관리자 페이지</h1>
                    <p>관리할 설정을 선택하세요.</p>
                </div>
                <span className="category-tag">관리자 전용</span>
            </header>

            {/* 🔥 고급형 4열 모니터링 대시보드 위젯 🔥 */}
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-10 w-full max-w-[1200px] mx-auto">
                {/* 1. 오늘 방문자 */}
                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-sm font-semibold text-slate-500">오늘 방문 트래픽</h3>
                        <Activity className="text-blue-500" size={18} />
                    </div>
                    <p className="text-3xl font-bold text-slate-900">{loading ? '-' : stats.todayVisitors.toLocaleString()}</p>
                </div>

                {/* 2. 누적 총 방문자 */}
                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-sm font-semibold text-slate-500">누적 총 트래픽</h3>
                        <Eye className="text-indigo-500" size={18} />
                    </div>
                    <p className="text-3xl font-bold text-slate-900">{loading ? '-' : stats.totalVisits.toLocaleString()}</p>
                </div>

                {/* 3. 오늘 신규 가입 */}
                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-sm font-semibold text-slate-500">오늘 신규 가입</h3>
                        <UserPlus className="text-emerald-500" size={18} />
                    </div>
                    <p className="text-3xl font-bold text-slate-900">{loading ? '-' : stats.todayNewUsers.toLocaleString()}</p>
                </div>

                {/* 4. 전체 가입자 */}
                <div className="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-sm font-semibold text-slate-500">피드AI 총 가입자</h3>
                        <Users className="text-violet-500" size={18} />
                    </div>
                    <p className="text-3xl font-bold text-slate-900">{loading ? '-' : stats.totalUsers.toLocaleString()}</p>
                </div>
            </div>

            <nav className="admin-home-grid" aria-label="관리자 설정">
                {sections.map(({ href, title, description, Icon }) => (
                    <a className="admin-home-card" key={href} href={href}>
                        <span className="admin-home-icon"><Icon size={24} /></span>
                        <h2>{title}<ArrowUpRight size={18} /></h2>
                        <p>{description}</p>
                    </a>
                ))}
            </nav>
        </div>
    );
}