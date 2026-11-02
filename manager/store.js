// 管理页共享可变状态(各 UI 模块读写同一对象)。

export const store = {
  settings: {},
  sessions: [],
  currentId: null, // 当前查看的会话 id
  full: null, // 未裁剪的完整会话数据
  cache: null, // 按提交范围(时间轴选区 / 默认最近 N 步)裁剪后的数据
  scope: null, // { fromTs, toTs, label } 当前生效范围;null 表示全量
  fullScope: false, // 用户点了"查看全部"
  selected: new Set(), // 勾选要提交的 action id
  collapsed: new Set(), // 折叠的页面 key
  sortMode: 'desc', // 页面排序:desc 最新在前 / asc 最早在前(仅影响视图)
  search: '', // 页面搜索过滤
  subjectDirty: false,
  descDirty: false,
};
