'use client';

import { useState } from 'react';
import { supabase } from '../../lib/supabase';
import AlertModal from '../../components/AlertModal'; // 💡 아까 만드신 알림창 부품 연결
import Link from 'next/link';

export default function SignUpForm() {
    const [formData, setFormData] = useState({
        username: '',
        email: '',
        password: '',
        passwordConfirm: '',
        phone: '',
    });
    const [agreed, setAgreed] = useState(false);
    const [loading, setLoading] = useState(false);

    // 알림창 상태 관리
    const [alertConfig, setAlertConfig] = useState<{ isOpen: boolean; message: string; type: 'error' | 'success' | 'info' }>({ isOpen: false, message: '', type: 'info' });

    const showAlert = (message: string, type: 'error' | 'success' | 'info' = 'error') => {
        setAlertConfig({ isOpen: true, message, type });
    };

    // 전화번호 입력 시 자동으로 하이픈(-) 넣어주기
    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        let { name, value } = e.target;
        if (name === 'phone') {
            value = value.replace(/[^0-9]/g, '');
            if (value.length > 3 && value.length <= 7) value = value.replace(/(\d{3})(\d+)/, '$1-$2');
            else if (value.length > 7) value = value.replace(/(\d{3})(\d{4})(\d+)/, '$1-$2-$3');
        }
        setFormData({ ...formData, [name]: value });
    };

    // 회원가입 버튼 눌렀을 때 실행되는 메인 로직
    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();

        // 1. 비밀번호 패턴 검사 (영문, 숫자, 특수문자 포함 8자리 이상)
        const passwordRegex = /^(?=.*[a-zA-Z])(?=.*\d)(?=.*[!@#$%^&*()_+={}\[\]:;"'<>,.?/\\|`~-]).{8,}$/;
        if (!passwordRegex.test(formData.password)) {
            return showAlert('비밀번호는 영문, 숫자, 특수문자를\n최소 1개 이상 포함하여 8자리 이상이어야 합니다.', 'error');
        }

        // 2. 비밀번호 확인 검사
        if (formData.password !== formData.passwordConfirm) {
            return showAlert('비밀번호가 일치하지 않습니다.\n다시 확인해 주세요.', 'error');
        }

        // 3. 약관 동의 검사
        if (!agreed) {
            return showAlert('서비스 약관에 동의해 주셔야 가입이 가능합니다.', 'error');
        }

        setLoading(true);

        // 4. Supabase로 최종 회원가입 요청 쏴주기
        const { data, error: signUpError } = await supabase.auth.signUp({
            email: formData.email,
            password: formData.password,
            options: {
                data: {
                    name: formData.username, // DB 방아쇠가 낚아챌 이름
                    phone: formData.phone,   // 연락처 정보
                },
                emailRedirectTo: `${window.location.origin}/login`, // 인증 후 로그인 화면으로 복귀
            }
        });

        setLoading(false);

        // 5. 결과 처리 (에러 났을 때)
        if (signUpError) {
            if (signUpError.message.includes('already registered')) {
                return showAlert('이미 가입된 이메일입니다.\n로그인을 진행해 주세요.', 'error');
            }
            return showAlert(`가입 중 문제가 발생했습니다.\n${signUpError.message}`, 'error');
        }

        // 6. 결과 처리 (성공했을 때 - 이메일 인증 대기 상태 확인)
        if (data?.user && !data?.session) {
            showAlert('✉️ 인증 이메일이 발송되었습니다!\n\n입력하신 이메일함에서 [인증 링크]를 클릭하셔야\n최종 회원가입이 완료됩니다.', 'success');
        } else {
            showAlert('🎉 회원가입이 완료되었습니다!\n이제 로그인해 주세요.', 'success');
        }
    };

    return (
        <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '100vh', backgroundColor: '#f3f4f6' }}>
            <div style={{ backgroundColor: 'white', padding: '40px', borderRadius: '12px', boxShadow: '0 10px 25px rgba(0,0,0,0.05)', width: '100%', maxWidth: '400px' }}>
                <h2 style={{ textAlign: 'center', fontSize: '24px', fontWeight: 'bold', marginBottom: '24px', color: '#111827' }}>회원가입</h2>
                
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                    <div>
                        <input type="text" name="username" placeholder="아이디 (이름)" required value={formData.username} onChange={handleChange} style={{ width: '100%', padding: '12px', border: '1px solid #d1d5db', borderRadius: '8px', boxSizing: 'border-box', outline: 'none' }} />
                    </div>
                    <div>
                        <input type="email" name="email" placeholder="이메일 주소" required value={formData.email} onChange={handleChange} style={{ width: '100%', padding: '12px', border: '1px solid #d1d5db', borderRadius: '8px', boxSizing: 'border-box', outline: 'none' }} />
                    </div>
                    <div>
                        <input type="password" name="password" placeholder="비밀번호 (영문+숫자+특수문자 8자리 이상)" required value={formData.password} onChange={handleChange} style={{ width: '100%', padding: '12px', border: '1px solid #d1d5db', borderRadius: '8px', boxSizing: 'border-box', outline: 'none' }} />
                    </div>
                    <div>
                        <input type="password" name="passwordConfirm" placeholder="비밀번호 확인" required value={formData.passwordConfirm} onChange={handleChange} style={{ width: '100%', padding: '12px', border: '1px solid #d1d5db', borderRadius: '8px', boxSizing: 'border-box', outline: 'none' }} />
                    </div>
                    <div>
                        <input type="tel" name="phone" placeholder="연락처 (숫자만 입력)" required value={formData.phone} onChange={handleChange} maxLength={13} style={{ width: '100%', padding: '12px', border: '1px solid #d1d5db', borderRadius: '8px', boxSizing: 'border-box', outline: 'none' }} />
                    </div>
                    
                    <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '14px', color: '#4b5563', marginTop: '4px', cursor: 'pointer' }}>
                        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} style={{ width: '16px', height: '16px', cursor: 'pointer' }} />
                        서비스 약관 및 개인정보 처리방침에 동의합니다.
                    </label>
                    
                    <button type="submit" disabled={loading} style={{ marginTop: '8px', padding: '14px', backgroundColor: '#2563eb', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', fontSize: '16px', cursor: 'pointer' }}>
                        {loading ? '처리 중...' : '회원가입 완료'}
                    </button>
                </form>

                <div style={{ marginTop: '24px', textAlign: 'center', fontSize: '14px', color: '#6b7280' }}>
                    이미 계정이 있으신가요? <Link href="/login" style={{ color: '#2563eb', fontWeight: '600', textDecoration: 'none' }}>로그인</Link>
                </div>
            </div>

            {/* 성공/실패 시 예쁘게 뜨는 팝업창 컴포넌트 */}
            <AlertModal 
                isOpen={alertConfig.isOpen} 
                message={alertConfig.message} 
                type={alertConfig.type}
                onClose={() => {
                    setAlertConfig({ ...alertConfig, isOpen: false });
                    // 가입 성공(이메일 발송 안내) 창을 닫을 때 로그인 화면으로 튕겨냄
                    if (alertConfig.type === 'success') {
                        window.location.href = '/login';
                    }
                }} 
            />
        </div>
    );
}