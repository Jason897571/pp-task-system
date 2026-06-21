import { theme } from 'antd'
import type { ThemeConfig } from 'antd'

// "分屏暗色 Pro" tokens — deep navy surfaces + violet→cyan neon accents.
export const trelloDarkTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: '#7c5cff',
    colorInfo: '#7c5cff',
    colorLink: '#22d3ee',
    colorBgBase: '#0a0c14',
    colorBgContainer: '#131a2b',
    colorBgElevated: '#161d2e',
    colorText: '#c7d0e2',
    colorTextHeading: '#ffffff',
    colorBorder: '#ffffff22',
    borderRadius: 9,
    fontFamily:
      '-apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  },
}

export const C = {
  bgGrad: 'radial-gradient(1100px 620px at 50% -8%, #1b2348 0%, #0a0c14 58%)',
  topbar: '#0f1320',
  listBg: '#121829f2',
  cardBg: '#161d2e',
  cardHover: '#1b2440',
  text: '#c7d0e2',
  subtle: '#8a92a8',
  heading: '#ffffff',
  line: '#ffffff16',
  blue: '#7c5cff',
  accent: '#22d3ee',
}
