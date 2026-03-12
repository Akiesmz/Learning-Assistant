// 消息样式
export const messageContainer = (role: 'user' | 'assistant') => ({
  display: 'flex',
  flexDirection: role === 'user' ? 'row-reverse' : 'row',
  marginBottom: '24px',
  gap: '12px',
});

export const messageAvatar = (role: 'user' | 'assistant') => ({
  width: '36px',
  height: '36px',
  borderRadius: '50%',
  background: role === 'user' ? '#1677ff' : '#8c8c8c',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#fff',
  flexShrink: 0,
  marginTop: '4px',
});

export const messageContent = (role: 'user' | 'assistant') => ({
  maxWidth: '85%',
  display: 'flex',
  flexDirection: 'column',
  alignItems: role === 'user' ? 'flex-end' : 'flex-start',
});

export const messageCard = (role: 'user' | 'assistant') => ({
  background: role === 'user' ? 'var(--bubble-user-bg)' : 'var(--bubble-ai-bg)',
  borderRadius: role === 'user' ? '18px 4px 18px 18px' : '4px 18px 18px 18px',
  border: 'none',
  boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
  position: 'relative' as const,
});

export const messageBody = (role: 'user' | 'assistant') => ({
  color: role === 'user' ? 'var(--bubble-user-fg)' : 'var(--bubble-ai-fg)',
  fontSize: '15px',
  lineHeight: '1.6',
});

export const messageFooter = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginTop: '12px',
  borderTop: '1px solid var(--border-color)',
  paddingTop: '8px',
};

export const messageActions = {
  display: 'flex',
  gap: '8px',
};

export const messageActionButton = {
  padding: 0,
  height: 'auto',
  fontSize: '12px',
  display: 'flex',
  alignItems: 'center',
  gap: '4px',
};

export const messageRoleLabel = {
  fontSize: '11px',
  color: 'var(--muted-fg)',
  marginTop: '4px',
  padding: '0 4px',
};

export const relatedQuestionsContainer = {
  marginTop: '10px',
  width: '100%',
};

export const relatedQuestionsTitle = {
  fontSize: '12px',
};

export const relatedQuestionsGrid = {
  marginTop: '8px',
  display: 'grid',
  gridTemplateColumns: '1fr',
  gap: '8px',
};

export const relatedQuestionCard = {
  borderRadius: '10px',
  cursor: 'pointer',
  border: '1px solid var(--border-color)',
};

export const chatInputContainer = {
  padding: '10px',
  background: 'var(--surface-bg)',
  borderRadius: '8px',
  boxShadow: '0 -2px 10px rgba(0,0,0,0.05)',
  transition: 'background-color 300ms ease',
};

export const chatInputFooter = {
  marginTop: '8px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
};

export const chatInputLeft = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
};

export const chatInputRight = {
  fontSize: '12px',
};

export const sourcesDrawerContainer = {
  display: 'flex',
  flexDirection: 'column',
  gap: '16px',
};

export const sourceCard = {
  border: '1px solid var(--border-color)',
};

export const sourceCardTitle = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
};

export const sourceCardTitleLeft = {
  display: 'flex',
  gap: '8px',
  alignItems: 'center',
};

export const sourceCardTitleRight = {
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  minWidth: 0,
};

export const sourceCardSource = {
  fontSize: '12px',
  maxWidth: '240px',
};

export const sourceCardScores = {
  marginBottom: '8px',
  fontSize: '12px',
  color: 'var(--muted-fg)',
};

export const sourceCardContent = {
  fontSize: '14px',
  lineHeight: '1.6',
};

export const emptySources = {
  textAlign: 'center',
  padding: '40px',
  color: 'var(--muted-fg)',
};
