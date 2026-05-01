import React from 'react';

interface SidebarProps {
  currentPath?: string;
  isAdmin?: boolean;
}

const Sidebar: React.FC<SidebarProps> = ({ currentPath = '/', isAdmin = false }) => {
  const isActive = (path: string) => currentPath === path;

  const NavLink = ({ icon, label, href, active }: { icon: string; label: string; href: string; active: boolean }) => (
    <a 
      href={href}
      className={`flex items-center gap-3 p-3 rounded-xl transition-all font-medium ${
        active 
          ? 'bg-[#007bff] text-white shadow-lg shadow-blue-100' 
          : 'text-gray-600 hover:bg-[#007bff] hover:text-white'
      }`}
    >
      <i className={icon}></i> {label}
    </a>
  );

  const ToolTile = ({ icon, label, href }: { icon: string; label: string; href: string }) => (
    <a 
      href={href}
      className="flex flex-col items-center justify-center gap-2 p-3 aspect-square rounded-xl border border-[#dbe7ff] bg-[#f8fbff] text-gray-600 text-[0.75rem] font-bold text-center leading-tight hover:bg-[#007bff] hover:text-white hover:border-[#007bff] transition-all"
    >
      <i className={`${icon} text-[1.1rem]`}></i>
      <span>{label}</span>
    </a>
  );

  return (
    <aside id="sidebar" className="fixed top-0 left-0 w-[260px] h-full bg-white border-r border-[#dbe7ff] p-4 z-50 overflow-y-auto soft-scroll">
      <div className="flex items-center gap-3 mb-8 px-2">
        <div className="w-10 h-10 bg-[#007bff] rounded-lg flex items-center justify-center text-white font-bold text-xl shadow-lg shadow-blue-200">
          V
        </div>
        <div>
          <h1 className="text-lg font-bold text-slate-800 leading-none">VNA Server</h1>
          <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">VNA Web</span>
        </div>
      </div>

      <nav className="flex flex-col gap-1">
        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 px-3">Hệ thống</div>
        <NavLink icon="fas fa-home" label="Trang chủ" href="/" active={isActive('/')} />
        <button className="w-full text-left flex items-center gap-3 p-3 rounded-xl text-gray-600 hover:bg-[#007bff] hover:text-white transition-all font-medium">
          <i className="fas fa-copy"></i> Copy IP
        </button>
        <NavLink icon="fas fa-chart-line" label="Status server" href="/html/status-server.html" active={isActive('/html/status-server.html')} />
        <NavLink icon="fas fa-cloud" label="Cloud" href="/cloud" active={isActive('/cloud')} />
        <NavLink icon="fas fa-trophy" label="Leaderboard" href="/leaderboard" active={isActive('/leaderboard')} />
        <NavLink icon="fas fa-gem" label="Donate" href="/A11/donet.html" active={isActive('/A11/donet.html')} />

        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 px-3 mt-4">Tiện ích</div>
        <div className="grid grid-cols-2 gap-2">
          <ToolTile icon="fa-brands fa-facebook-f" label="Facebook" href="/p/snapsave.html" />
          <ToolTile icon="fa-brands fa-tiktok" label="TikTok" href="/html/tiktok.html" />
          <ToolTile icon="fa-brands fa-youtube" label="YouTube" href="/html/youtube.html" />
          <ToolTile icon="fa-brands fa-twitter" label="X" href="/x" />
          <ToolTile icon="fas fa-download" label="Minecraft" href="/html/dowloadmc.html" />
          <ToolTile icon="fas fa-user-check" label="Whitelist" href="/whitelist" />
        </div>

        <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 px-3 mt-4">Kho rác</div>
        <NavLink icon="fas fa-toolbox" label="Kho công cụ" href="/p/kho.html" active={isActive('/p/kho.html')} />

        {isAdmin && (
          <>
            <div className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-2 px-3 mt-4">Quản trị</div>
            <NavLink icon="fas fa-sliders" label="Cấu hình server" href="/admin/server-settings.html" active={isActive('/admin/server-settings.html')} />
            <NavLink icon="fas fa-bullhorn" label="Thông báo Discord" href="/admin/e.html" active={isActive('/admin/e.html')} />
            <NavLink icon="fas fa-user-shield" label="Whitelist Admin" href="/admin/whitelist.html" active={isActive('/admin/whitelist.html')} />
            <NavLink icon="fas fa-plus-square" label="Thêm Nút Minecraft" href="/admin/p.html" active={isActive('/admin/p.html')} />
          </>
        )}
      </nav>
    </aside>
  );
};

export default Sidebar;
