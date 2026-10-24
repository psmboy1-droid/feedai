import { getDb } from '../db';
import { sql } from 'drizzle-orm';

export async function isDeletedMember(userId: string) {
    const db = getDb();
    
    // 💡 결과를 ( ... )로 묶은 뒤 as { deleted_at: string | null } 을 추가합니다.
    const row = (await db.get(
        sql`SELECT deleted_at FROM news_accounts WHERE user_id = ${userId}`
    )) as { deleted_at: string | null } | undefined;
    
    return Boolean(row?.deleted_at);
}

export async function touchMember(user: { userId: string; displayName: string; email: string }) {
    const db = getDb();
    const now = new Date().toISOString();
    
    // 💡 데이터를 반환받을 필요가 없는 INSERT 문이므로 db.run() 사용
    await db.run(sql`
        INSERT INTO news_accounts (user_id, display_name, email, state, created_at, updated_at) 
        VALUES (${user.userId}, ${user.displayName}, ${user.email}, ${JSON.stringify({feeds:[],saved:[],read:[]})}, ${now}, ${now}) 
        ON CONFLICT (user_id) DO NOTHING
    `);

    // 💡 데이터를 반환받을 필요가 없는 UPDATE 문이므로 db.run() 사용
    await db.run(sql`
        UPDATE news_accounts 
        SET display_name = CASE WHEN display_name = '' THEN ${user.displayName} ELSE display_name END,
            email = ${user.email} 
        WHERE user_id = ${user.userId} 
          AND (deleted_at IS NULL OR deleted_at = '') 
          AND (email != ${user.email} OR display_name = '')
    `);
}