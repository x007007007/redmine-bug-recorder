// 管理页共享可变状态(各 UI 模块读写同一对象)。

export const store = {
  settings: {},
  sessions: [],
  currentId: null, // 当前查看的会话 id
  cache: null, // { session, actions, requests, logs, pinia }
  selected: new Set(), // 勾选要提交的 action id
  collapsed: new Set(), // 折叠的页面 key
  sortMode: 'desc', // 页面排序:desc 最新在前 / asc 最早在前(仅影响视图)
  search: '', // 页面搜索过滤
  subjectDirty: false,
  descDirty: false,
};
