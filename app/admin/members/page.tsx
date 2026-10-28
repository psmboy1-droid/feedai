"use client";

import { useState, useEffect } from 'react';

type Member = {
    id: string;
    name: string;
    email: string;
    plan: 'free' | 'basic' | 'pro' | null;
    expiresAt: string | null;
    tokens: number;
    revision: number;
    createdAt: string;
    feedCount: number;
    isAdmin: boolean;
};

export default function MembersPage() {
    const [members, setMembers] = useState<Member[]>([]);
    const [total, setTotal] = useState(0);
    const [loading, setLoading] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');

    const fetchMembers = async (q = '') => {
        setLoading(true);
        try {
            const res = await fetch(`/api/admin/members?q=${encodeURIComponent(q)}&page=1`);
            const data = await res.json();
            
            if (res.ok && data.members) {
                setMembers(data.members);
                setTotal(data.total || 0);
            } else {
                console.error('API 응답 에러:', data.error);
                if (data.error === '관리자만 접근할 수 있습니다.') {
                    alert('관리자 권한이 없습니다. 로컬 로그인을 확인해주세요.');
                }
            }
        } catch (error) {
            console.error('데이터 로딩 실패:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchMembers();
    }, []);

    const handleSearch = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'Enter') fetchMembers(searchQuery);
    };

    // 지인 테스트용: 등급(Pro) 및 크레딧(Tokens) 수정 기능
    const handleUpdate = async (member: Member) => {
        const newPlan = prompt(`[${member.name}] 님의 등급을 입력하세요 (free / basic / pro)`, member.plan || 'free');
        if (!newPlan || !['free', 'basic', 'pro'].includes(newPlan)) return;

        const newTokens = prompt('지급할 크레딧 숫자를 입력하세요 (예: 1000)', String(member.tokens));
        if (newTokens === null || isNaN(Number(newTokens))) return;

        // Pro 등급 부여 시 1년(또는 한 달) 뒤 만료일 임시 세팅
        const expiresAt = newPlan === 'free' ? '' : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();

        try {
            const res = await fetch('/api/admin/members', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: member.id,
                    revision: member.revision,
                    originalTokens: member.tokens,
                    name: member.name,
                    tokens: Number(newTokens),
                    plan: newPlan,
                    expiresAt: expiresAt
                })
            });
            const data = await res.json();
            if (res.ok) {
                alert('회원 정보가 성공적으로 변경되었습니다.');
                fetchMembers(searchQuery); // 갱신
            } else {
                alert(`변경 실패: ${data.error}`);
            }
        } catch (err) {
            alert('수정 중 오류가 발생했습니다.');
        }
    };

    const handleDelete = async (member: Member) => {
        if (!confirm(`정말로 [${member.name}] 회원을 삭제(비활성화) 하시겠습니까?`)) return;

        try {
            const res = await fetch('/api/admin/members', {
                method: 'DELETE',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    userId: member.id,
                    revision: member.revision
                })
            });
            const data = await res.json();
            if (res.ok) {
                alert('회원이 삭제되었습니다.');
                fetchMembers(searchQuery);
            } else {
                alert(`삭제 실패: ${data.error}`);
            }
        } catch (err) {
            alert('삭제 중 오류가 발생했습니다.');
        }
    };

    const formatDate = (dateString: string) => {
        return new Intl.DateTimeFormat('ko-KR', {
            year: 'numeric', month: '2-digit', day: '2-digit',
            hour: 'numeric', minute: '2-digit', second: '2-digit'
        }).format(new Date(dateString));
    };

    return (
        <div className="admin-page" style={{ padding: '2rem', maxWidth: '1200px', margin: '0 auto' }}>
            <header className="mb-8">
                <a href="/admin" className="text-sm text-blue-500 hover:underline mb-2 inline-block">← 관리자 페이지</a>
                <p className="text-xs font-bold text-gray-500 tracking-wider mb-1">ADMIN · MEMBERS</p>
                <h1 className="text-3xl font-bold mb-2">회원 관리</h1>
                <p className="text-gray-600">회원 {total}명 · 회원 정보와 분석 크레딧을 관리하세요.</p>
            </header>

            <div className="flex gap-2 mb-6">
                <input 
                    type="text" 
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={handleSearch}
                    placeholder="이름·이메일·회원 ID 검색 후 엔터" 
                    className="flex-1 p-2 border border-gray-300 rounded-md focus:outline-none focus:border-blue-500"
                />
                <button onClick={() => fetchMembers(searchQuery)} className="px-4 py-2 border border-gray-300 rounded-md bg-white hover:bg-gray-50">검색</button>
                <button onClick={() => { setSearchQuery(''); fetchMembers(''); }} className="px-4 py-2 border border-gray-300 rounded-md bg-white hover:bg-gray-50">목록 새로고침</button>
            </div>

            <div className="bg-white border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                <table className="w-full text-left border-collapse">
                    <thead className="bg-gray-50 border-b border-gray-200">
                        <tr>
                            <th className="p-4 font-semibold text-gray-600">회원</th>
                            <th className="p-4 font-semibold text-gray-600">크레딧</th>
                            <th className="p-4 font-semibold text-gray-600">구독 소스</th>
                            <th className="p-4 font-semibold text-gray-600">가입일</th>
                            <th className="p-4 font-semibold text-gray-600 text-right">관리</th>
                        </tr>
                    </thead>
                    <tbody>
                        {loading ? (
                            <tr><td colSpan={5} className="p-8 text-center text-gray-500">데이터를 불러오는 중입니다...</td></tr>
                        ) : members.map((member) => (
                            <tr key={member.id} className="border-b border-gray-100 hover:bg-gray-50">
                                <td className="p-4">
                                    <div className="font-bold text-gray-900 flex items-center gap-2">
                                        {member.name}
                                        {member.isAdmin && <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">관리자</span>}
                                    </div>
                                    <div className="text-sm text-gray-500">{member.email}</div>
                                    <div className="text-xs text-gray-400 mt-1">{member.id}</div>
                                </td>
                                <td className="p-4">
                                    <div className="font-bold text-gray-900 capitalize">{member.plan || 'Free'}</div>
                                    <div className="text-sm text-gray-500">{member.tokens.toLocaleString()} 크레딧</div>
                                    {member.expiresAt && (
                                        <div className="text-xs text-gray-400 mt-1">종료 {formatDate(member.expiresAt)}</div>
                                    )}
                                </td>
                                <td className="p-4 text-sm text-gray-600">
                                    {member.feedCount}
                                </td>
                                <td className="p-4 text-sm text-gray-600">
                                    {formatDate(member.createdAt)}
                                </td>
                                <td className="p-4 text-right">
                                    <button 
                                        onClick={() => handleUpdate(member)}
                                        className="text-blue-500 hover:text-blue-700 font-medium mr-3"
                                    >
                                        수정
                                    </button>
                                    <button 
                                        onClick={() => handleDelete(member)}
                                        className="text-red-400 hover:text-red-600 font-medium"
                                    >
                                        삭제
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {members.length === 0 && !loading && (
                            <tr><td colSpan={5} className="p-8 text-center text-gray-500">데이터가 없습니다.</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>
    );
}