// components/AlertModal.tsx
import React from 'react';

interface AlertModalProps {
    isOpen: boolean;
    message: string;
    onClose: () => void;
    type?: 'error' | 'success' | 'info';
}

export default function AlertModal({ isOpen, message, onClose, type = 'info' }: AlertModalProps) {
    if (!isOpen) return null;

    const getIcon = () => {
        if (type === 'error') return <svg width="24" height="24" fill="none" stroke="#ef4444" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 8v4m0 4h.01"/></svg>;
        if (type === 'success') return <svg width="24" height="24" fill="none" stroke="#22c55e" strokeWidth="2" viewBox="0 0 24 24"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4L12 14.01l-3-3"/></svg>;
        return <svg width="24" height="24" fill="none" stroke="#3b82f6" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4m0-4h.01"/></svg>;
    };

    return (
        <div style={{ position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh', backgroundColor: 'rgba(0,0,0,0.4)', display: 'flex', justifyContent: 'center', alignItems: 'center', zIndex: 99999 }}>
            <div style={{ backgroundColor: 'white', padding: '24px', borderRadius: '12px', width: '90%', maxWidth: '320px', boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)', textAlign: 'center', animation: 'fadeIn 0.2s ease-out' }}>
                <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '16px' }}>
                    <div style={{ padding: '10px', backgroundColor: type === 'error' ? '#fef2f2' : type === 'success' ? '#f0fdf4' : '#eff6ff', borderRadius: '50%' }}>
                        {getIcon()}
                    </div>
                </div>
                <p style={{ color: '#374151', fontSize: '15px', fontWeight: '500', marginBottom: '24px', lineHeight: '1.5', whiteSpace: 'pre-wrap' }}>
                    {message}
                </p>
                <button onClick={onClose} style={{ width: '100%', padding: '10px', backgroundColor: '#2563eb', color: 'white', border: 'none', borderRadius: '8px', fontWeight: '600', cursor: 'pointer' }}>
                    확인
                </button>
            </div>
        </div>
    );
}