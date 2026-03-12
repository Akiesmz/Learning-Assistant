export type ThemeConfig = {
  token?: Record<string, string | number>;
  components?: Record<string, Record<string, string | number>>;
};

export const themeConfig: ThemeConfig = {
  token: {
    // 主题色体系
    colorPrimary: '#1677ff',
    colorPrimaryHover: '#4096ff',
    colorPrimaryActive: '#0958d9',
    colorPrimaryBorder: '#d6e4ff',
    colorPrimaryBg: '#e6f4ff',
    colorPrimaryText: '#0958d9',
    
    // 辅助色
    colorSuccess: '#52c41a',
    colorWarning: '#faad14',
    colorError: '#ff4d4f',
    colorInfo: '#1677ff',
    
    // 中性色
    colorText: '#333333',
    colorTextSecondary: '#666666',
    colorTextTertiary: '#999999',
    colorTextQuaternary: '#bfbfbf',
    
    // 背景色
    colorBgContainer: '#ffffff',
    colorBgElevated: '#f5f5f5',
    colorBgLayout: '#f0f2f5',
    
    // 边框色
    colorBorder: '#e8e8e8',
    colorBorderSecondary: '#f0f0f0',
    
    // 圆角规范
    borderRadius: 8,
    borderRadiusLG: 10,
    borderRadiusSM: 4,
    
    // 阴影规范
    boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
    boxShadowSecondary: '0 4px 12px rgba(0, 0, 0, 0.1)',
    boxShadowTertiary: '0 8px 24px rgba(0, 0, 0, 0.12)',
    
    // 间距规范
    marginXS: 4,
    marginSM: 8,
    marginMD: 16,
    marginLG: 24,
    marginXL: 32,
    
    paddingXS: 4,
    paddingSM: 8,
    paddingMD: 16,
    paddingLG: 24,
    paddingXL: 32,
    
    // 字体规范
    fontSize: 14,
    fontSizeSM: 12,
    fontSizeLG: 16,
    fontSizeXL: 20,
    
    lineHeight: 1.5715,
    lineHeightSM: 1.4286,
    lineHeightLG: 1.6,
  },
  components: {
    Layout: {
      headerBg: 'var(--surface-bg)',
      siderBg: 'var(--surface-bg)',
    },
    Button: {
      borderRadius: 8,
    },
    Tag: {
      borderRadius: 4,
    },
    Card: {
      borderRadius: 10,
      boxShadow: '0 2px 8px rgba(0, 0, 0, 0.08)',
    },
    Input: {
      borderRadius: 8,
    },
    Select: {
      borderRadius: 8,
    },
    Form: {
      labelHeight: 32,
    },
    Table: {
      borderRadius: 10,
    },
    Drawer: {
      borderRadius: 10,
    },
    Modal: {
      borderRadius: 10,
    },

  },
};

export type DensityMode = 'compact' | 'comfortable';

export const getDensityConfig = (mode: DensityMode): Partial<ThemeConfig> => {
  if (mode === 'compact') {
    return {
      token: {
        fontSize: 13,
        marginXS: 2,
        marginSM: 6,
        marginMD: 12,
        marginLG: 16,
        marginXL: 24,
        
        paddingXS: 2,
        paddingSM: 6,
        paddingMD: 12,
        paddingLG: 16,
        paddingXL: 24,
        
        lineHeight: 1.4286,
        lineHeightSM: 1.3333,
        lineHeightLG: 1.5,
      },
    };
  }
  return {};
};
