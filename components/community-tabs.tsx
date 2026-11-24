'use client';

import React from 'react';
import { Flame, MessageCircle, HelpCircle } from 'lucide-react';

export type BoardType = 'hot' | 'free' | 'suggestions';

interface CommunityTabsProps {
    currentBoard: BoardType;
}

export function CommunityTabs({ currentBoard }: CommunityTabsProps) {
    const tabs: { type: BoardType; label: string; href: string; icon: React.ReactNode }[] = [
        {
            type: 'hot',
            label: 'HOT',
            href: '/community/hot',
            icon: <Flame size={16} className="tab-icon icon-flame" />,
        },
        {
            type: 'free',
            label: '자유 게시판',
            href: '/community/free',
            icon: <MessageCircle size={16} className="tab-icon" />,
        },
        {
            type: 'suggestions',
            label: '건의 게시판',
            href: '/community/suggestions',
            icon: <HelpCircle size={16} className="tab-icon" />,
        },
    ];

    return (
        <nav className="community-tabs" aria-label="커뮤니티 게시판 탭">
            {tabs.map((tab) => {
                const isActive = currentBoard === tab.type;
                return (
                    <a
                        key={tab.type}
                        href={tab.href}
                        className={`community-tab-item ${isActive ? 'active' : ''}`}
                        aria-current={isActive ? 'page' : undefined}
                    >
                        {tab.icon}
                        <span>{tab.label}</span>
                    </a>
                );
            })}
        </nav>
    );
}

export default CommunityTabs;
