import React, { useEffect, useMemo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { LogIn, Search, List, Star, Menu, LayoutDashboard, Wallet, History, Bell, LifeBuoy, RefreshCw, Users, Package, CreditCard, ShieldCheck, ChevronDown, Sparkles, ArrowRight, CheckCircle2, MessageSquare, FileText } from 'lucide-react'
import { api, ensureCsrf, money, numberId } from './api'
import './styles.css'

const nav = [
  ['/', 'Utama'], ['/services', 'Layanan'], ['/faq', 'FAQ'], ['/terms', 'Ketentuan'], ['/status-pesanan', 'Status']
]
const pageTitles = {
  '/faq': 'Pertanyaan Umum', '/terms': 'Ketentuan Layanan', '/status-pesanan': 'Status Pesanan', '/contoh-pengisian-target': 'Contoh Target', '/keuntungan-join': 'Keuntungan Join', '/smm-panel': 'SMM Panel', '/sewa-smm': 'Sewa SMM', '/tool': 'Tool', '/contact': 'Kontak', '/api/docs': 'API Docs'
}

function useAsync(loader, deps = []) {
  const [state, setState] = useState({ loading: true, data: null, error: '' })
  useEffect(() => {
    let alive = true
    setState((s) => ({ ...s, loading: true, error: '' }))
    loader().then((data) => alive && setState({ loading: false, data, error: '' })).catch((error) => alive && setState({ loading: false, data: null, error: error.message }))
    return () => { alive = false }
  }, deps)
  return state
}

function Shell({ children, user }) {
  const [open, setOpen] = useState(false)
  return <>
    <header className="site-nav-wrap">
      <nav className="site-nav">
        <a className="brand" href="/"><span className="brand-mark">M</span><b>SMM Panel</b></a>
        <button className="mobile-toggle" onClick={() => setOpen(!open)}><Menu size={20}/></button>
        <div className={open ? 'nav-links open' : 'nav-links'}>
          {nav.map(([href, label]) => <a key={href} className={location.pathname === href ? 'active' : ''} href={href}>{label}</a>)}
          {user ? <a className="nav-pill" href={user.role === 'admin' ? '/admin' : '/dashboard'}>Dashboard</a> : <a className="nav-pill" href="/login"><LogIn size={16}/> Masuk</a>}
        </div>
      </nav>
    </header>
    {children}
  </>
}

function Hero({ title, subtitle, compact = false, children }) {
  return <section className={compact ? 'hero compact' : 'hero'}>
    <div className="hero-shape one"/><div className="hero-shape two"/><div className="dots"/>
    <div className="container hero-inner">{children || <><p className="eyebrow">SMM Panel Indonesia</p><h1>{title}</h1><p>{subtitle}</p></>}</div>
    <div className="wave wave-a"/><div className="wave wave-b"/>
  </section>
}

function Landing({ user }) {
  const { data } = useAsync(() => api('/api/public/stats'), [])
  const services = useAsync(() => api('/api/public/services?limit=6&sort=popular'), [])
  const stats = data?.stats || {}
  return <Shell user={user}>
    <Hero>
      <div className="hero-copy">
        <p className="eyebrow">SMM Panel Indonesia Terbaik dan Termurah</p>
        <h1>PUSAT SMM Panel Indonesia Terbaik</h1>
        <p>Website penyedia layanan sosial media lengkap, murah, cepat, dan rapi untuk reseller, creator, dan bisnis kecil.</p>
        <div className="hero-actions"><a className="btn white" href="/login"><LogIn size={17}/> Masuk</a><a className="btn ghost" href="/register">Register</a></div>
      </div>
      <div className="hero-visual"><div className="phone-card"><Sparkles/><h3>Order lebih mudah</h3><p>Deposit, order, refill, dan ticket support dalam satu panel.</p><div className="floating-bubble">👍</div><div className="floating-bubble alt">💬</div></div></div>
    </Hero>
    <section className="stats-row container">
      <Stat value={stats.total_users || 0} label="Pengguna Aktif" />
      <Stat value={stats.total_orders || 0} label="Pesanan Dikerjakan" />
      <Stat value={stats.total_services || 0} label="Layanan Tersedia" />
    </section>
    <section className="section container split">
      <div><p className="eyebrow blue">Kenapa memilih kami?</p><h2>SMM Panel yang clean, cepat, dan mudah dipakai.</h2><p>Struktur dibuat untuk user baru dan reseller: katalog layanan jelas, detail layanan, status pesanan, support ticket, dan mutasi saldo.</p></div>
      <div className="feature-grid"><Feature title="Layanan Berkualitas" text="Katalog layanan sosial media dengan harga/K, min, maks, rating, dan estimasi."/><Feature title="Pelayanan Bantuan" text="Support ticket dan refill request membuat bantuan tidak tercecer."/><Feature title="Desain Responsif" text="Frontend React membuat tampilan lebih halus di desktop dan mobile."/></div>
    </section>
    <section className="section container"><SectionHead title="Layanan Sosial Media Populer" text="Preview layanan aktif dari database." action={<a href="/services">Lihat semua <ArrowRight size={16}/></a>}/><div className="service-cards">{(services.data?.services || []).map(s => <ServiceMini key={s.id} service={s}/>)}</div></section>
    <Testimonials />
    <FAQ />
    <Footer />
  </Shell>
}

function Stat({ value, label }) { return <div className="stat-card"><strong>{numberId(value)}</strong><span>{label}</span></div> }
function Feature({ title, text }) { return <article className="feature"><CheckCircle2/><h3>{title}</h3><p>{text}</p></article> }
function SectionHead({ title, text, action }) { return <div className="section-head"><div><h2>{title}</h2><p>{text}</p></div>{action}</div> }
function ServiceMini({ service }) { return <article className="service-mini"><span>{service.kategori}</span><h3>{service.nama}</h3><p>{service.description || 'Layanan siap digunakan melalui dashboard panel.'}</p><b>{money(service.harga)} <small>/ 1000</small></b></article> }

function Testimonials() { return <section className="section testimonials"><h2>Apa Kata Mereka?</h2><div className="testimonial-row"><div className="test-card side">“Panelnya simpel dan enak dipakai.”</div><div className="test-card main">“Melebihi hasil yang diharapkan. Sangat disarankan untuk reseller dan creator.”<div className="avatar-row"><span>👤</span><b>Doni hamzah</b><small>Content Creator</small></div></div><div className="test-card side">“Sudah 3 tahun pakai web.”</div></div></section> }
function FAQ() { const [open, setOpen] = useState(0); const qs=[['Apa itu SMM panel?','Social Media Marketing Panel adalah platform untuk memesan layanan sosial media seperti followers, likes, views, dan engagement lain.'],['Bagaimana cara membuat pesanan?','Daftar akun, deposit saldo, pilih layanan, isi target, lalu buat order.'],['Apa itu partial?','Partial berarti order hanya masuk sebagian dan sisa dapat dikembalikan sesuai ketentuan.']]; return <section className="section container faq-wrap"><div><h2>Pertanyaan Umum</h2><p>Berikut beberapa pertanyaan yang sering ditanyakan client terkait layanan.</p><div className="faq-illustration">🧑‍💻</div></div><div className="faq-list">{qs.map((q,i)=><div className="faq-item" key={q[0]}><button onClick={()=>setOpen(open===i?-1:i)}>{q[0]}<ChevronDown size={18}/></button>{open===i&&<p>{q[1]}</p>}</div>)}</div></section> }
function Footer(){return <footer className="footer"><div className="container"><b>SMM Panel</b><p>Frontend React + Vite, backend Express + MySQL.</p></div></footer>}

function ServicesPage({ user }) {
  const [params, setParams] = useState({ q: '', kategori: '', sort: 'fastest', page: 1 })
  const query = new URLSearchParams({ ...params, limit: 25 }).toString()
  const { loading, data, error } = useAsync(() => api(`/api/public/services?${query}`), [query])
  const categories = data?.categories || []
  const grouped = data?.grouped || {}
  return <Shell user={user}><Hero compact title="Layanan" subtitle="Katalog layanan sosial media dengan filter, sorting, harga/K, estimasi, rating, dan detail."/>
    <main className="container services-shell">
      <div className="services-card">
        <div className="services-title"><h2><List size={20}/> Layanan</h2><span>Total data terfilter: {numberId(data?.pagination?.total || 0)}</span></div>
        <div className="filter-row"><select value={params.kategori} onChange={e=>setParams({...params,kategori:e.target.value,page:1})}><option value="">Semua</option>{categories.map(c=><option key={c.kategori} value={c.kategori}>{c.kategori}</option>)}</select><select value={params.sort} onChange={e=>setParams({...params,sort:e.target.value,page:1})}><option value="fastest">Sortir Waktu Tercepat</option><option value="rating_high">Rating Tertinggi</option><option value="rating_low">Rating Terendah</option><option value="cheapest">Harga Termurah</option><option value="expensive">Harga Termahal</option></select><div className="search-box"><input placeholder="Cari..." value={params.q} onChange={e=>setParams({...params,q:e.target.value,page:1})}/><button><Search size={19}/></button></div></div>
        {error && <Alert>{error}</Alert>}{loading && <Skeleton/>}
        {!loading && <div className="table-wrap">{Object.keys(grouped).length===0 ? <Empty/> : Object.entries(grouped).map(([cat, rows]) => <table className="mp-table" key={cat}><thead><tr className="cat-row"><th colSpan="8">{cat} [ No Refill ]</th></tr><tr><th>ID</th><th>Layanan</th><th>Harga/K</th><th>Min.</th><th>Maks.</th><th>Waktu Rata-rata</th><th>Rating</th><th></th></tr></thead><tbody>{rows.map(s=><ServiceRow key={s.id} service={s}/>)}</tbody></table>)}</div>}
      </div>
    </main></Shell>
}
function ServiceRow({ service }) { return <tr><td>{service.id}</td><td className="service-name">{service.nama}</td><td>{money(service.harga)}</td><td>{numberId(service.min_order)}</td><td>{numberId(service.max_order)}</td><td>Jumlah pesan rata-rata {numberId(service.total_orders || 0)}.<br/>Waktu proses rata-rata {service.avg_time || 'Bertahap'}.</td><td className="stars">★★★★★</td><td><a className="detail-btn" href={`/services/${service.id}`}>Detail</a></td></tr> }

function AuthPage({ mode }) { const [form,setForm]=useState({username:'',email:'',password:''}); const [msg,setMsg]=useState(''); const [err,setErr]=useState(''); async function submit(e){e.preventDefault();setErr('');setMsg('');try{await ensureCsrf(); const res=await api(`/api/auth/${mode}`,{method:'POST',body:JSON.stringify(form)}); if(mode==='login') location.href=res.user.role==='admin'?'/admin':'/dashboard'; else {setMsg('Registrasi berhasil. Silakan login.'); setTimeout(()=>location.href='/login',700)}}catch(error){setErr(error.message)}} return <Shell><main className="auth-page"><div className="auth-card"><div className="auth-brand"><span className="brand-mark">M</span><h1>{mode==='login'?'Masuk Panel':'Daftar Akun'}</h1><p>Masuk untuk order layanan, deposit saldo, dan pantau status pesanan.</p></div><form onSubmit={submit}><h2>{mode==='login'?'Login':'Register'}</h2>{mode==='register'&&<input placeholder="Username" value={form.username} onChange={e=>setForm({...form,username:e.target.value})}/>}<input placeholder="Email" value={form.email} onChange={e=>setForm({...form,email:e.target.value})}/><input type="password" placeholder="Password" value={form.password} onChange={e=>setForm({...form,password:e.target.value})}/>{err&&<Alert>{err}</Alert>}{msg&&<Success>{msg}</Success>}<button className="btn primary">{mode==='login'?'Masuk':'Register'}</button><p>{mode==='login'?'Belum punya akun?':'Sudah punya akun?'} <a href={mode==='login'?'/register':'/login'}>{mode==='login'?'Register':'Login'}</a></p></form></div></main></Shell> }

function AppLayout({ user, children, admin=false }) { const links=admin? [['/admin','Dashboard',LayoutDashboard],['/admin/orders','Order',Package],['/admin/users','User',Users],['/admin/services','Layanan',List],['/admin/deposits','Deposit',Wallet],['/admin/tickets','Ticket',LifeBuoy],['/admin/refills','Refill',RefreshCw],['/admin/payment-methods','Pembayaran',CreditCard],['/admin/notifications','Notifikasi',Bell]] : [['/dashboard','Dashboard',LayoutDashboard],['/orders','Riwayat Order',History],['/deposit','Deposit',Wallet],['/deposits','Riwayat Deposit',CreditCard],['/balance-logs','Mutasi Saldo',FileText],['/support','Support',LifeBuoy],['/refills','Refill',RefreshCw]]; return <div className="app-shell"><aside><a className="brand" href="/"><span className="brand-mark">M</span><b>SMM Panel</b></a><nav>{links.map(([href,label,Icon])=><a className={location.pathname===href?'active':''} href={href} key={href}><Icon size={18}/>{label}</a>)}</nav><button className="logout" onClick={()=>api('/api/auth/logout',{method:'POST'}).then(()=>location.href='/')}>Logout</button></aside><main><div className="app-top"><div><p>{admin?'Admin Panel':'Customer Panel'}</p><h1>{admin?'Dashboard Admin':`Halo, ${user?.username || 'User'}`}</h1></div><div className="balance-pill">Saldo: {money(user?.saldo || 0)}</div></div>{children}</main></div> }

function CustomerDashboard({ user }) { const {data,loading,error}=useAsync(()=>api('/api/customer/dashboard'),[]); const [keyword,setKeyword]=useState(''); const services=(data?.services||[]).filter(s=>(s.nama+s.kategori).toLowerCase().includes(keyword.toLowerCase())); return <AppLayout user={data?.user||user}><div className="dash-hero"><div><h2>Pusat Order Sosial Media</h2><p>Pilih layanan, masukkan target, dan sistem menghitung estimasi otomatis.</p></div><a className="btn white" href="/deposit">Deposit Saldo</a></div><SummaryCards items={[['Total Order',data?.summary?.total_orders],['Total Deposit',data?.summary?.total_deposits],['Ticket Terbuka',data?.summary?.open_tickets]]}/><div className="panel"><input className="wide-search" placeholder="Cari layanan atau kategori..." value={keyword} onChange={e=>setKeyword(e.target.value)}/>{error&&<Alert>{error}</Alert>}{loading?<Skeleton/>:<div className="order-grid">{services.map(s=><OrderCard service={s} key={s.id}/>)}</div>}</div></AppLayout> }
function OrderCard({ service }){const [target,setTarget]=useState('');const [jumlah,setJumlah]=useState('');const [msg,setMsg]=useState('');const [err,setErr]=useState('');const total=Math.ceil((Number(service.harga||0)*Number(jumlah||0))/1000);async function submit(e){e.preventDefault();setErr('');setMsg('');try{await api('/api/customer/orders',{method:'POST',body:JSON.stringify({service_id:service.id,target,jumlah})});setMsg('Order berhasil dibuat.');setTarget('');setJumlah('')}catch(error){setErr(error.message)}}return <form className="order-card" onSubmit={submit}><div><span>{service.kategori}</span><b>{money(service.harga)} / 1000</b></div><h3>{service.nama}</h3><p>Min {numberId(service.min_order)} - Max {numberId(service.max_order)}</p><input placeholder={service.target_hint||'Link / username target'} value={target} onChange={e=>setTarget(e.target.value)}/><input placeholder="Jumlah" value={jumlah} onChange={e=>setJumlah(e.target.value)}/><strong>Estimasi: {money(total)}</strong>{err&&<Alert>{err}</Alert>}{msg&&<Success>{msg}</Success>}<button className="btn primary">Buat Order</button></form>}
function SummaryCards({items}){return <div className="summary-grid">{items.map(([l,v])=><div className="summary" key={l}><span>{l}</span><b>{numberId(v||0)}</b></div>)}</div>}

function DataTablePage({ user, title, endpoint, rowsKey, columns, admin=false }){const {data,loading,error}=useAsync(()=>api(endpoint),[endpoint]);const rows=data?.[rowsKey]||[];return <AppLayout user={user} admin={admin}><div className="panel"><SectionHead title={title} text="Data terbaru dari backend Express API."/>{error&&<Alert>{error}</Alert>}{loading?<Skeleton/>:<SimpleTable rows={rows} columns={columns}/>}</div></AppLayout>}
function SimpleTable({rows,columns}){return <div className="table-wrap"><table className="mp-table app-table"><thead><tr>{columns.map(c=><th key={c[0]}>{c[1]}</th>)}</tr></thead><tbody>{rows.length?rows.map((r,i)=><tr key={r.id||i}>{columns.map(c=><td key={c[0]}>{c[2]?c[2](r):String(r[c[0]]??'-')}</td>)}</tr>):<tr><td colSpan={columns.length}><Empty/></td></tr>}</tbody></table></div>}

function DepositPage({user}){const {data}=useAsync(()=>api('/api/customer/payment-methods'),[]);const [form,setForm]=useState({amount:'',metode:''});const [file,setFile]=useState(null);const [msg,setMsg]=useState('');const [err,setErr]=useState('');async function submit(e){e.preventDefault();setErr('');setMsg('');try{const fd=new FormData();fd.append('amount',form.amount);fd.append('metode',form.metode);if(file)fd.append('proof_image',file);await api('/api/customer/deposits',{method:'POST',body:fd});setMsg('Deposit berhasil dikirim.')}catch(error){setErr(error.message)}}return <AppLayout user={user}><div className="panel form-panel"><h2>Deposit Saldo</h2><p>Minimal deposit {money(data?.minDeposit||10000)}. Pilih metode lalu upload bukti transfer.</p><form onSubmit={submit}><select value={form.metode} onChange={e=>setForm({...form,metode:e.target.value})}><option value="">Pilih Metode</option>{(data?.methods||[]).map(m=><option key={m.id} value={m.name}>{m.name} - {m.account_number}</option>)}</select><input placeholder="Nominal" value={form.amount} onChange={e=>setForm({...form,amount:e.target.value})}/><input type="file" onChange={e=>setFile(e.target.files?.[0])}/>{err&&<Alert>{err}</Alert>}{msg&&<Success>{msg}</Success>}<button className="btn primary">Kirim Deposit</button></form></div></AppLayout>}

function SupportPage({user}){const {data}=useAsync(()=>api('/api/customer/support'),[]);const [form,setForm]=useState({subject:'',category:'general',message:''});const [msg,setMsg]=useState('');async function submit(e){e.preventDefault();await api('/api/customer/support',{method:'POST',body:JSON.stringify(form)});setMsg('Ticket terkirim.');}return <AppLayout user={user}><div className="panel form-panel"><h2>Support Ticket</h2><form onSubmit={submit}><input placeholder="Subjek" value={form.subject} onChange={e=>setForm({...form,subject:e.target.value})}/><textarea placeholder="Pesan" value={form.message} onChange={e=>setForm({...form,message:e.target.value})}/>{msg&&<Success>{msg}</Success>}<button className="btn primary">Kirim Ticket</button></form><SimpleTable rows={data?.tickets||[]} columns={[["id","ID"],["subject","Subjek"],["status","Status"],["created_at","Tanggal"]]}/></div></AppLayout>}
function RefillsPage({user}){const {data}=useAsync(()=>api('/api/customer/refills'),[]);const [form,setForm]=useState({order_id:'',reason:''});const [msg,setMsg]=useState('');async function submit(e){e.preventDefault();await api('/api/customer/refills',{method:'POST',body:JSON.stringify(form)});setMsg('Request refill terkirim.')}return <AppLayout user={user}><div className="panel form-panel"><h2>Request Refill</h2><form onSubmit={submit}><select value={form.order_id} onChange={e=>setForm({...form,order_id:e.target.value})}><option value="">Pilih order selesai</option>{(data?.completedOrders||[]).map(o=><option key={o.id} value={o.id}>#{o.id} - {o.service_name}</option>)}</select><textarea placeholder="Alasan refill" value={form.reason} onChange={e=>setForm({...form,reason:e.target.value})}/>{msg&&<Success>{msg}</Success>}<button className="btn primary">Kirim Refill</button></form><SimpleTable rows={data?.refills||[]} columns={[["id","ID"],["order_id","Order"],["status","Status"],["reason","Alasan"]]}/></div></AppLayout>}

function AdminDashboard({user}){const {data}=useAsync(()=>api('/api/admin/summary'),[]);return <AppLayout user={user} admin><div className="dash-hero"><div><h2>Admin Command Center</h2><p>Pantau order, deposit, ticket, refill, dan layanan.</p></div><ShieldCheck size={56}/></div><SummaryCards items={[["User",data?.summary?.total_users],["Order",data?.summary?.total_orders],["Deposit Pending",data?.summary?.pending_deposits],["Ticket",data?.summary?.open_tickets],["Refill",data?.summary?.pending_refills],["Layanan Aktif",data?.summary?.active_services]]}/></AppLayout>}

function PublicPage({ user, slug }){const {data,loading,error}=useAsync(()=>api(`/api/public/page/${slug}`),[slug]);return <Shell user={user}><Hero compact title={data?.page?.title || pageTitles['/'+slug] || 'Halaman'} subtitle={data?.page?.subtitle || ''}/><main className="container public-card">{loading?<Skeleton/>:error?<Alert>{error}</Alert>:<div className="content-grid">{(data?.page?.blocks||[]).map(b=><article className="feature" key={b.title}><h3>{b.title}</h3><p>{b.body}</p></article>)}</div>}</main></Shell>}
function TargetExamples({ user }){const {data}=useAsync(()=>api('/api/public/target-examples'),[]);return <Shell user={user}><Hero compact title="Contoh Pengisian Target" subtitle="Panduan format target agar order tidak salah."/><main className="container public-card"><SimpleTable rows={data?.examples||[]} columns={[["platform","Platform"],["service_type","Jenis"],["target_format","Format"],["example","Contoh"],["note","Catatan"]]}/></main></Shell>}
function ServiceDetail({ user, id }){const {data,loading,error}=useAsync(()=>api(`/api/public/services/${id}`),[id]);const s=data?.service;return <Shell user={user}><Hero compact title={s?.nama||'Detail Layanan'} subtitle={s?.kategori||''}/><main className="container public-card">{loading?<Skeleton/>:error?<Alert>{error}</Alert>:<div className="detail-layout"><div><h2>{s.nama}</h2><p>{s.description||'Detail layanan sosial media.'}</p><div className="detail-list"><span>Harga/K <b>{money(s.harga)}</b></span><span>Min <b>{numberId(s.min_order)}</b></span><span>Maks <b>{numberId(s.max_order)}</b></span><span>Rating <b>{s.rating || 5} ★</b></span><span>Start <b>{s.start_time || '-'}</b></span><span>Speed <b>{s.speed || '-'}</b></span></div></div><a className="btn primary" href="/dashboard">Order Sekarang</a></div>}</main></Shell>}

function Alert({children}){return <div className="alert error">{children}</div>}
function Success({children}){return <div className="alert success">{children}</div>}
function Skeleton(){return <div className="skeleton"><span/><span/><span/></div>}
function Empty(){return <div className="empty">Belum ada data.</div>}

function Router(){const [me,setMe]=useState(null);const [ready,setReady]=useState(false);useEffect(()=>{ensureCsrf().finally(()=>api('/api/me').then(d=>setMe(d.user)).catch(()=>{}).finally(()=>setReady(true)))},[]);const path=location.pathname;if(!ready)return <div className="boot">Memuat panel...</div>;if(path==='/')return <Landing user={me}/>;if(path==='/services')return <ServicesPage user={me}/>;if(path.startsWith('/services/'))return <ServiceDetail user={me} id={path.split('/')[2]}/>;if(path==='/login')return <AuthPage mode="login"/>;if(path==='/register')return <AuthPage mode="register"/>;if(path==='/contoh-pengisian-target')return <TargetExamples user={me}/>;if(['/faq','/terms','/status-pesanan','/keuntungan-join','/smm-panel','/sewa-smm','/tool','/contact','/api/docs'].includes(path))return <PublicPage user={me} slug={path.replace('/','').replace('api/docs','api-docs')}/>;if(!me)return <AuthPage mode="login"/>;if(path==='/dashboard')return <CustomerDashboard user={me}/>;if(path==='/orders')return <DataTablePage user={me} title="Riwayat Order" endpoint="/api/customer/orders" rowsKey="orders" columns={[["id","ID"],["nama_layanan","Layanan"],["target","Target"],["jumlah","Jumlah",r=>numberId(r.jumlah)],["total","Total",r=>money(r.total)],["status","Status"]]}/>;if(path==='/deposit')return <DepositPage user={me}/>;if(path==='/deposits')return <DataTablePage user={me} title="Riwayat Deposit" endpoint="/api/customer/deposits" rowsKey="deposits" columns={[["id","ID"],["amount","Nominal",r=>money(r.amount)],["metode","Metode"],["status","Status"],["tanggal","Tanggal"]]}/>;if(path==='/balance-logs')return <DataTablePage user={me} title="Mutasi Saldo" endpoint="/api/customer/balance-logs" rowsKey="logs" columns={[["id","ID"],["type","Tipe"],["amount","Nominal",r=>money(r.amount)],["description","Deskripsi"],["created_at","Tanggal"]]}/>;if(path==='/support')return <SupportPage user={me}/>;if(path==='/refills')return <RefillsPage user={me}/>;if(path==='/admin')return <AdminDashboard user={me}/>;if(path==='/admin/orders')return <DataTablePage admin user={me} title="Order" endpoint="/api/admin/orders" rowsKey="orders" columns={[["id","ID"],["username","User"],["nama_layanan","Layanan"],["total","Total",r=>money(r.total)],["status","Status"]]}/>;if(path==='/admin/users')return <DataTablePage admin user={me} title="User" endpoint="/api/admin/users" rowsKey="users" columns={[["id","ID"],["username","Username"],["email","Email"],["saldo","Saldo",r=>money(r.saldo)],["role","Role"],["status","Status"]]}/>;if(path==='/admin/services')return <DataTablePage admin user={me} title="Layanan" endpoint="/api/admin/services" rowsKey="services" columns={[["id","ID"],["kategori","Kategori"],["nama","Layanan"],["harga","Harga/K",r=>money(r.harga)],["status","Status"]]}/>;if(path==='/admin/deposits')return <DataTablePage admin user={me} title="Deposit" endpoint="/api/admin/deposits" rowsKey="deposits" columns={[["id","ID"],["username","User"],["amount","Nominal",r=>money(r.amount)],["metode","Metode"],["status","Status"]]}/>;if(path==='/admin/balance-logs')return <DataTablePage admin user={me} title="Mutasi Saldo" endpoint="/api/admin/balance-logs" rowsKey="logs" columns={[["id","ID"],["username","User"],["type","Tipe"],["amount","Nominal",r=>money(r.amount)],["description","Deskripsi"]]}/>;if(path==='/admin/notifications')return <DataTablePage admin user={me} title="Notifikasi" endpoint="/api/admin/notifications" rowsKey="notifications" columns={[["id","ID"],["title","Judul"],["message","Pesan"],["is_read","Read"]]}/>;if(path==='/admin/tickets')return <DataTablePage admin user={me} title="Ticket" endpoint="/api/admin/tickets" rowsKey="tickets" columns={[["id","ID"],["username","User"],["subject","Subjek"],["status","Status"]]}/>;if(path==='/admin/refills')return <DataTablePage admin user={me} title="Refill" endpoint="/api/admin/refills" rowsKey="refills" columns={[["id","ID"],["username","User"],["order_id","Order"],["status","Status"],["reason","Alasan"]]}/>;if(path==='/admin/payment-methods')return <DataTablePage admin user={me} title="Metode Pembayaran" endpoint="/api/admin/payment-methods" rowsKey="methods" columns={[["id","ID"],["name","Nama"],["type","Tipe"],["account_number","Nomor"],["is_active","Aktif"]]}/>;return <PublicPage user={me} slug="faq"/>}

createRoot(document.getElementById('root')).render(<Router />)
