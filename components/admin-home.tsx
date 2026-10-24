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

            {/* 🔥 기존 UI 테마(admin-home-grid)를 완벽하게 재사용한 모니터링 위젯 🔥 */}
            <div className="admin-home-grid" style={{ paddingBottom: '3rem', borderBottom: '1px solid #e2e8f0', marginBottom: '3rem' }}>
                <div className="admin-home-card" style={{ cursor: 'default' }}>
                    <span className="admin-home-icon" style={{ color: '#3b82f6' }}><Activity size={24} /></span>
                    <h2 style={{ fontSize: '2.2rem', margin: '0.5rem 0' }}>{loading ? '-' : stats.todayVisitors.toLocaleString()}</h2>
                    <p style={{ fontWeight: 600 }}>오늘 방문자 수 (DAU)</p>
                </div>
                
                <div className="admin-home-card" style={{ cursor: 'default' }}>
                    <span className="admin-home-icon" style={{ color: '#6366f1' }}><Eye size={24} /></span>
                    <h2 style={{ fontSize: '2.2rem', margin: '0.5rem 0' }}>{loading ? '-' : stats.totalVisits.toLocaleString()}</h2>
                    <p style={{ fontWeight: 600 }}>누적 총 방문자</p>
                </div>

                <div className="admin-home-card" style={{ cursor: 'default' }}>
                    <span className="admin-home-icon" style={{ color: '#10b981' }}><UserPlus size={24} /></span>
                    <h2 style={{ fontSize: '2.2rem', margin: '0.5rem 0' }}>{loading ? '-' : stats.todayNewUsers.toLocaleString()}</h2>
                    <p style={{ fontWeight: 600 }}>오늘 신규 가입</p>
                </div>

                <div className="admin-home-card" style={{ cursor: 'default' }}>
                    <span className="admin-home-icon" style={{ color: '#8b5cf6' }}><Users size={24} /></span>
                    <h2 style={{ fontSize: '2.2rem', margin: '0.5rem 0' }}>{loading ? '-' : stats.totalUsers.toLocaleString()}</h2>
                    <p style={{ fontWeight: 600 }}>피드AI 총 가입자</p>
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