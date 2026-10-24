'use client';
import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import Link from 'next/link'; // 🚀 1. 페이지 이동을 위한 Next.js Link 추가

export default function LoginPage() {
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');

    // 🚀 2. 진짜 이메일 로그인 로직
    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        const { error } = await supabase.auth.signInWithPassword({ email, password });
        
        if (error) {
            alert(`로그인 실패: ${error.message}`);
        } else {
            window.location.href = '/'; // 성공 시 메인 화면으로 직행!
        }
    };

    // (기존에 있던 에러 유발 handleSignUp 로직은 깔끔하게 삭제했습니다!)

    // 🚀 3. 진짜 구글/카카오 소셜 로그인 로직
    const handleSocialLogin = async (provider: 'google' | 'kakao') => {
        const { error } = await supabase.auth.signInWithOAuth({
            provider: provider,
            options: {
                redirectTo: window.location.origin, // 성공 시 메인 주소로 돌아오기
            }
        });
        if (error) alert(`${provider} 로그인 에러: ${error.message}`);
    };

    return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#f3f4f6', width: '100vw', margin: 0, position: 'absolute', top: 0, left: 0, zIndex: 9999 }}>
            <div style={{ backgroundColor: 'white', padding: '48px 40px', borderRadius: '12px', boxShadow: '0 10px 25px rgba(0,0,0,0.05)', width: '100%', maxWidth: '420px' }}>
                
                {/* 헤더 섹션 */}
                <div style={{ textAlign: 'center', marginBottom: '32px' }}>
                    <div style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginBottom: '8px' }}>
                        <div style={{ backgroundColor: '#2563eb', color: 'white', borderRadius: '8px', padding: '6px', display: 'flex' }}>
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 11a9 9 0 0 1 9 9"/><path d="M4 4a16 16 0 0 1 16 16"/><circle cx="5" cy="19" r="1"/></svg>
                        </div>
                        <h1 style={{ fontSize: '28px', fontWeight: '900', color: '#111827', margin: 0, letterSpacing: '-0.5px' }}>
                            피드AI
                        </h1>
                    </div>
                    <p style={{ color: '#6b7280', fontSize: '15px', margin: 0 }}>관심 있는 소식만, 한곳에서.</p>
                </div>

                {/* 소셜 로그인 버튼 */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', marginBottom: '24px' }}>
                    <button type="button" onClick={() => handleSocialLogin('google')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', width: '100%', padding: '12px', backgroundColor: 'white', border: '1px solid #d1d5db', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '15px', color: '#374151' }}>
                        <svg width="20" height="20" viewBox="0 0 24 24"><path fill="#EA4335" d="M24 12.27c0-.85-.08-1.66-.21-2.45H12v4.54h6.85c-.29 1.48-1.12 2.74-2.39 3.58v2.98h3.87C22.58 18.84 24 15.86 24 12.27z"/><path fill="#4285F4" d="M12 24c3.38 0 6.22-1.11 8.29-3.02l-3.87-2.98c-1.12.75-2.55 1.2-4.42 1.2-3.4 0-6.28-2.29-7.31-5.38H.74v3.1C2.82 21.05 7.07 24 12 24z"/><path fill="#FBBC05" d="M4.69 16.82c-.27-.8-.42-1.66-.42-2.55s.15-1.75.42-2.55V8.62H.74C.27 9.56 0 10.63 0 11.75s.27 2.19.74 3.13l3.95-3.06z"/><path fill="#34A853" d="M12 4.7c1.84 0 3.49.63 4.79 1.88l3.6-3.6C18.2 1.09 15.37 0 12 0 7.07 0 2.82 2.95.74 7.2l3.95 3.06c1.03-3.09 3.91-5.38 7.31-5.38z"/></svg>
                        Google 계정으로 계속
                    </button>
                    <button type="button" onClick={() => handleSocialLogin('kakao')} style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', width: '100%', padding: '12px', backgroundColor: '#FEE500', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '15px', color: '#000000' }}>
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="#000000"><path d="M12 3c-5.523 0-10 3.522-10 7.87 0 2.809 1.838 5.26 4.636 6.643-.223.834-.8 3.018-.82 3.125-.062.33.122.327.262.23 0 0 3.32-2.146 4.707-3.076.398.058.81.088 1.215.088 5.523 0 10-3.522 10-7.87S17.523 3 12 3z"/></svg>
                        카카오 계정으로 계속
                    </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', marginBottom: '24px' }}>
                    <div style={{ flex: 1, height: '1px', backgroundColor: '#e5e7eb' }}></div>
                    <span style={{ padding: '0 12px', color: '#9ca3af', fontSize: '13px', fontWeight: '500' }}>또는 이메일로 로그인</span>
                    <div style={{ flex: 1, height: '1px', backgroundColor: '#e5e7eb' }}></div>
                </div>

                {/* 폼 섹션 */}
                <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="이메일 주소" required style={{ width: '100%', padding: '12px 16px', border: '1px solid #d1d5db', borderRadius: '8px', boxSizing: 'border-box', fontSize: '15px', outline: 'none' }} />
                    <input type="password" value={password} onChange={e => setPassword(e.target.value)} placeholder="비밀번호" required style={{ width: '100%', padding: '12px 16px', border: '1px solid #d1d5db', borderRadius: '8px', boxSizing: 'border-box', fontSize: '15px', outline: 'none' }} />
                    <button type="submit" style={{ width: '100%', padding: '14px', backgroundColor: '#2563eb', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '16px' }}>
                        로그인
                    </button>
                </form>

                {/* 🚀 4. a 태그 대신 Link 컴포넌트로 완벽하게 교체! */}
                <div style={{ marginTop: '24px', textAlign: 'center', fontSize: '14px', color: '#6b7280' }}>
                    계정이 없으신가요? <Link href="/signup" style={{ color: '#2563eb', fontWeight: '600', textDecoration: 'none' }}>회원가입</Link>
                </div>
            </div>
        </div>
    );
}