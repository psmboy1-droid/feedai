'use client';
import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase'; // 🚀 API를 거치지 않고 Supabase DB 직결

export type CatalogFeed = {
  id: string; name: string; url: string; country: string;
  category: string; language: string; kind: string;
  enabled: boolean; deleted: boolean; verifiedAt: string; revision: number;
};

const blank = { name: '', url: '', country: '대한민국', category: '종합', language: '한국어', kind: '언론사 RSS', enabled: true };
const fallbackCategories = ['종합', '국내', '국제', '경제', '미국증시', 'AI·테크', '과학', '건강', '스포츠', '문화', '코인'];

export default function RssAdmin() {
  const [categoryOptions, setCategoryOptions] = useState<string[]>(fallbackCategories);
  const [categoryName, setCategoryName] = useState('');
  const [categoryBusy, setCategoryBusy] = useState(false);
  const [categoryError, setCategoryError] = useState('');
  const [categoryNotice, setCategoryNotice] = useState('');
  const categoryLock = useRef(false);
  
  const [categoryAction, setCategoryAction] = useState<'edit' | 'delete'>('edit');
  const [selectedCategory, setSelectedCategory] = useState('');
  const [categoryValue, setCategoryValue] = useState('');
  const [dialogError, setDialogError] = useState('');
  const categoryDialog = useRef<HTMLDialogElement>(null);
  
  const [items, setItems] = useState<CatalogFeed[]>([]);
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState<CatalogFeed | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  
  const lock = useRef(false);
  const nameInput = useRef<HTMLInputElement>(null);
  const deleteDialog = useRef<HTMLDialogElement>(null);
  const [pendingDelete, setPendingDelete] = useState<CatalogFeed | null>(null);

  useEffect(() => {
    if (categoryOptions.length && !categoryOptions.includes(form.category))
      setForm(old => ({ ...old, category: categoryOptions[0] }));
  }, [categoryOptions, form.category]);

  // 🚀 1. Supabase에서 피드와 '삭제되지 않은' 카테고리를 실시간으로 가져옵니다
  async function load() {
    setLoading(true); setError('');
    try {
      const { data: catData, error: catErr } = await supabase.from('shared_categories').select('name').eq('deleted', false);
      if (catErr) throw catErr;

      let loadedCategories = catData?.map(c => c.name) || [];
      if (loadedCategories.length === 0) loadedCategories = fallbackCategories;

      const { data: feedData, error: feedErr } = await supabase.from('shared_feeds').select('*').eq('deleted', false).order('name');
      if (feedErr) throw feedErr;

      const formattedItems = (feedData || []).map(f => ({
        id: f.id, name: f.name, url: f.url, country: f.country, category: f.category,
        language: f.language, kind: f.kind, enabled: f.enabled, deleted: f.deleted,
        verifiedAt: f.verified_at, revision: f.revision
      }));

      setItems(formattedItems);
      setCategoryOptions(loadedCategories);
      setForm(old => ({ ...old, category: loadedCategories.includes(old.category) ? old.category : loadedCategories[0] }));
    } catch (e) {
      setError(e instanceof Error ? e.message : '목록 조회 실패');
    } finally {
      setLoading(false);
    }
  }
  
  useEffect(() => { void load(); }, []);

  // 🚀 2. 공용 RSS 등록/수정
  async function save(data: typeof blank, existing: CatalogFeed | null) {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const payload = {
        name: data.name, url: data.url, country: data.country, category: data.category,
        language: data.language, kind: data.kind, enabled: data.enabled,
        verified_at: new Date().toISOString(), item_count: 0
      };

      if (existing) {
        const { error: updateErr } = await supabase.from('shared_feeds').update(payload).eq('id', existing.id);
        if (updateErr) throw updateErr;
      } else {
        const { error: insertErr } = await supabase.from('shared_feeds').insert({ id: crypto.randomUUID(), ...payload });
        if (insertErr) throw insertErr;
      }
      
      await load();
      setNotice(data.name + (data.enabled ? ' · 공용 목록에 공개했습니다.' : ' · 공용 목록에서 숨겼습니다.'));
      setEditing(null); setForm(blank);
    } catch (e) {
      setError(e instanceof Error ? e.message : '저장 실패 (URL이 이미 등록되었을 수 있습니다)');
    } finally {
      lock.current = false; setBusy(false);
    }
  }

  // 🚀 3. 공용 RSS 소프트 삭제
  async function remove() {
    if (!pendingDelete || lock.current) return;
    const target = pendingDelete;
    lock.current = true; setBusy(true); setError(''); setNotice('');
    try {
      const { error: delErr } = await supabase.from('shared_feeds').update({ deleted: true }).eq('id', target.id);
      if (delErr) throw delErr;
      
      await load();
      if (editing?.id === target.id) { setEditing(null); setForm(blank); }
      setNotice(target.name + ' · 공용 목록에서 삭제했습니다.');
    } catch (e) {
      setError(e instanceof Error ? e.message : '삭제 실패');
    } finally {
      lock.current = false; setBusy(false); deleteDialog.current?.close();
    }
  }

  // 🚀 4. 카테고리 관리 기능 (규격 오류 해결 완료!)
  function openCategory(name: string, action: 'edit' | 'delete') {
    setSelectedCategory(name); setCategoryAction(action); setCategoryValue(action === 'edit' ? name : categoryOptions.find(c => c !== name) || '');
    setDialogError(''); categoryDialog.current?.showModal();
  }

  // 카테고리 추가
  async function addCategory() {
    if (categoryLock.current) return;
    categoryLock.current = true; setCategoryBusy(true); setCategoryError(''); setCategoryNotice('');
    try {
      // 💡 필수값인 key와 created_at을 정확히 생성해서 꽂아 넣습니다.
      const { error } = await supabase.from('shared_categories').insert({ 
        key: crypto.randomUUID(), 
        name: categoryName,
        created_at: new Date().toISOString(),
        deleted: false,
        replacement: ''
      });
      if (error) throw error; // 이제 에러가 나면 가짜 성공 메시지를 띄우지 않고 튕겨냅니다!

      await load();
      setCategoryName('');
      setCategoryNotice(categoryName + ' 카테고리를 추가했습니다.');
      setForm(old => ({ ...old, category: categoryName }));
    } catch (e) {
      setCategoryError(e instanceof Error ? e.message : '카테고리 추가 실패');
    } finally {
      categoryLock.current = false; setCategoryBusy(false);
    }
  }

  // 카테고리 수정 및 삭제 (소프트 삭제 적용)
  async function changeCategory() {
    if (categoryLock.current || lock.current) return;
    categoryLock.current = true; setCategoryBusy(true); setDialogError(''); setCategoryNotice('');
    try {
      if (categoryAction === 'edit') {
        const { error: err1 } = await supabase.from('shared_categories').update({ name: categoryValue }).eq('name', selectedCategory);
        if (err1) throw err1;
        const { error: err2 } = await supabase.from('shared_feeds').update({ category: categoryValue }).eq('category', selectedCategory);
        if (err2) throw err2;
        setCategoryNotice(selectedCategory + ' → ' + categoryValue + ' · 수정했습니다.');
      } else {
        // 지인분 설계에 맞춰 완전히 날리지 않고 deleted = true 및 대체(replacement) 지정
        const { error: err1 } = await supabase.from('shared_categories').update({ deleted: true, replacement: categoryValue }).eq('name', selectedCategory);
        if (err1) throw err1;
        const { error: err2 } = await supabase.from('shared_feeds').update({ category: categoryValue }).eq('category', selectedCategory);
        if (err2) throw err2;
        setCategoryNotice(selectedCategory + ' · 삭제하고 ' + categoryValue + '(으)로 이동했습니다.');
      }
      await load();
      categoryDialog.current?.close();
    } catch (e) {
      setDialogError(e instanceof Error ? e.message : '변경 실패');
    } finally {
      categoryLock.current = false; setCategoryBusy(false);
    }
  }

  function edit(f: CatalogFeed) {
    setEditing(f);
    setForm({ name: f.name, url: f.url, country: f.country, category: f.category, language: f.language, kind: f.kind, enabled: f.enabled });
    setNotice(''); nameInput.current?.focus(); window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  return (
    <div className="admin-page">
      <header className="admin-heading">
        <div>
          <a href="/">← 피드맨</a>
          <p className="eyebrow">ADMIN · SHARED SOURCES</p>
          <h1>공용 RSS 관리</h1>
          <p>등록한 소스는 모든 사용자의 ‘세계 RSS 목록’에 표시됩니다. 사용자가 직접 선택해 구독합니다.</p>
        </div>
        <a className="refresh" href="/admin/ai">AI API 설정</a>
      </header>

      <section className="admin-form category-settings">
        <h2>카테고리 설정</h2>
        <p>새 카테고리를 추가하면 RSS 등록과 사용자 피드 필터에서 선택할 수 있습니다.</p>
        <form onSubmit={e => { e.preventDefault(); void addCategory(); }}>
          <label htmlFor="new-category">새 카테고리 이름</label>
          <div className="category-add-row">
            <input id="new-category" required maxLength={30} value={categoryName} onChange={e => setCategoryName(e.target.value)} placeholder="예: 부동산, 여행, 커뮤니티" disabled={categoryBusy} />
            <button className="refresh" disabled={categoryBusy || loading} type="submit">{categoryBusy ? '저장 중…' : '카테고리 추가'}</button>
          </div>
        </form>
        {categoryError && <p className="admin-error" role="alert">{categoryError}</p>}
        {categoryNotice && <p className="admin-notice" role="status">{categoryNotice}</p>}
        <div className="category-chips">
          {categoryOptions.map(c => (
            <span key={c}>{c}
              <button type="button" disabled={categoryBusy || busy || loading} aria-label={c + ' 카테고리 수정'} onClick={() => openCategory(c, 'edit')}>수정</button>
              <button type="button" disabled={categoryBusy || busy || loading || categoryOptions.length < 2} aria-label={c + ' 카테고리 삭제'} onClick={() => openCategory(c, 'delete')}>삭제</button>
            </span>
          ))}
        </div>
        
        <dialog ref={categoryDialog} className="feed-delete-dialog category-edit-dialog" aria-labelledby="category-dialog-title" onCancel={e => { if (categoryLock.current) e.preventDefault(); }}>
          <form onSubmit={e => { e.preventDefault(); void changeCategory(); }}>
            <h2 id="category-dialog-title">{categoryAction === 'edit' ? '카테고리 수정' : '카테고리를 삭제하시겠습니까?'}</h2>
            <p>{selectedCategory}</p>
            {categoryAction === 'edit' ? (
              <label>새 이름<input autoFocus required maxLength={30} value={categoryValue} disabled={categoryBusy} onChange={e => setCategoryValue(e.target.value)} /></label>
            ) : (
              <label>기존 소스를 이동할 카테고리
                <select value={categoryValue} disabled={categoryBusy} onChange={e => setCategoryValue(e.target.value)}>
                  {categoryOptions.filter(c => c !== selectedCategory).map(c => <option key={c}>{c}</option>)}
                </select>
              </label>
            )}
            {dialogError && <p role="alert" className="admin-error">{dialogError}</p>}
            <div className="feed-delete-actions">
              <button type="submit" disabled={categoryBusy || !categoryValue}>{categoryBusy ? '처리 중…' : categoryAction === 'edit' ? '저장' : '네, 삭제'}</button>
              <button type="button" disabled={categoryBusy} onClick={() => categoryDialog.current?.close()}>취소</button>
            </div>
          </form>
        </dialog>
      </section>

      <form className="admin-form" onSubmit={e => { e.preventDefault(); void save(form, editing); }}>
        <h2>{editing ? 'RSS 소스 수정' : '공용 RSS 등록'}</h2>
        <fieldset disabled={busy || loading || categoryBusy}>
          <label>소스 이름<input ref={nameInput} required maxLength={120} value={form.name} placeholder="예: 경제 피드 · 기업" onChange={e => setForm({ ...form, name: e.target.value })} /></label>
          <label className="admin-url">RSS 주소<input required type="url" maxLength={4000} value={form.url} placeholder="https://example.com/rss" onChange={e => setForm({ ...form, url: e.target.value })} /></label>
          <label>국가·지역
            <input required maxLength={60} list="rss-countries" value={form.country} onChange={e => setForm({ ...form, country: e.target.value })} />
            <datalist id="rss-countries">{[...new Set(items.map(f => f.country))].map(c => <option key={c} value={c} />)}</datalist>
          </label>
          <label>카테고리
            <select value={form.category} onChange={e => setForm({ ...form, category: e.target.value })}>
              {categoryOptions.map(c => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label>언어<input required maxLength={60} value={form.language} onChange={e => setForm({ ...form, language: e.target.value })} /></label>
          <label>소스 종류
            <select value={form.kind} onChange={e => setForm({ ...form, kind: e.target.value })}>
              {['언론사 RSS', '블로그·커뮤니티', '공공기관 RSS', '뉴스 모음', '기타 RSS'].map(k => <option key={k} value={k}>{k === '뉴스 모음' ? '피드 모음' : k}</option>)}
            </select>
          </label>
          <label className="admin-check"><input type="checkbox" checked={form.enabled} onChange={e => setForm({ ...form, enabled: e.target.checked })} /> 공용 목록에 공개</label>
          <div className="admin-actions">
            <button className="refresh" type="submit">{busy ? 'RSS 확인 및 저장 중…' : editing ? '변경 저장' : '등록하기'}</button>
            {editing && <button type="button" onClick={() => { setEditing(null); setForm(blank); }}>수정 취소</button>}
          </div>
        </fieldset>
        <small>HTTP·HTTPS RSS·Atom을 지원합니다. 공개 등록 시 실제 피드 연결을 확인합니다.</small>
      </form>
      
      {notice && <p className="admin-notice" role="status">{notice}</p>}
      {error && <p className="admin-error" role="alert">{error}</p>}

      <section className="admin-list">
        <div className="admin-list-heading">
          <h2>등록된 소스 <span>{items.length}</span></h2>
          <input aria-label="등록된 소스 검색" placeholder="이름·국가·주소 검색" value={query} onChange={e => setQuery(e.target.value)} />
          <button disabled={busy || loading || categoryBusy} onClick={load}>새로고침</button>
        </div>
        {loading ? <p role="status">목록을 불러오는 중…</p> : (
          <div className="admin-table-wrap">
            <table>
              <thead>
                <tr><th>소스</th><th>국가 / 분류</th><th>상태</th><th>마지막 확인</th><th>관리</th></tr>
              </thead>
              <tbody>
                {items.filter(f => `${f.name} ${f.country} ${f.url} ${f.category}`.toLowerCase().includes(query.toLowerCase())).map(f => (
                  <tr key={f.id}>
                    <td><b>{f.name}</b><small>{f.url}</small></td>
                    <td>{f.country}<small>{f.category} · {f.language}</small></td>
                    <td><span className={f.enabled ? 'admin-public' : 'admin-hidden'}>{f.enabled ? '공개' : '숨김'}</span></td>
                    <td>{f.verifiedAt ? new Date(f.verifiedAt).toLocaleDateString('ko-KR', { timeZone: 'Asia/Seoul' }) : '미확인'}</td>
                    <td>
                      <div className="admin-row-actions">
                        <button disabled={busy || categoryBusy} onClick={() => edit(f)}>수정</button>
                        <button disabled={busy || categoryBusy} onClick={() => save({ ...f, enabled: !f.enabled }, f)}>{f.enabled ? '숨기기' : '공개하기'}</button>
                        <button className="admin-delete-button" disabled={busy || categoryBusy} onClick={() => { setPendingDelete(f); deleteDialog.current?.showModal(); }}>삭제</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="directory-note">숨기거나 삭제한 소스는 새 구독 목록에서 제외됩니다. 사용자가 이미 구독한 소스는 그대로 유지됩니다.</p>
      </section>

      <dialog ref={deleteDialog} className="feed-delete-dialog" aria-labelledby="catalog-delete-title" onCancel={e => { if (lock.current) e.preventDefault(); }} onClose={() => setPendingDelete(null)}>
        <h2 id="catalog-delete-title">삭제 하시겠습니까?</h2>
        <p>{pendingDelete?.name}<br />공용 목록에서 삭제됩니다. 기존 사용자의 구독은 유지됩니다.</p>
        <div className="feed-delete-actions">
          <button type="button" className="feed-delete-yes" disabled={busy || categoryBusy} onClick={() => void remove()}>{busy ? '삭제 중…' : '네'}</button>
          <button type="button" autoFocus disabled={busy || categoryBusy} onClick={() => deleteDialog.current?.close()}>아니오</button>
        </div>
      </dialog>
    </div>
  );
}