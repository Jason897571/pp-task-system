import { theme } from 'antd'
import type { ThemeConfig } from 'antd'

// Trello dark-mode tokens (see spec §7.1 / demo/board-dark.html).
export const trelloDarkTheme: ThemeConfig = {
  algorithm: theme.darkAlgorithm,
  token: {
    colorPrimary: '#579dff',
    colorBgBase: '#1d2125',
    colorBgContainer: '#22272b',
    colorBgElevated: '#282e33',
    colorText: '#b6c2cf',
    colorTextHeading: '#dee4ea',
    colorBorder: '#ffffff1f',
    borderRadius: 8,
    fontFamily:
      '-apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  },
}

export const C = {
  bgGrad: 'linear-gradient(135deg, #3d2a5e 0%, #523568 45%, #6b3f6a 100%)',
  topbar: '#1d2125',
  listBg: '#1d2125f2',
  cardBg: '#22272b',
  cardHover: '#282e33',
  text: '#b6c2cf',
  subtle: '#9fadbc',
  heading: '#dee4ea',
  line: '#ffffff1f',
  blue: '#579dff',
}
