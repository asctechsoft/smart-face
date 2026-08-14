/**
 * Thư viện component dùng chung — docs/16-quy-chuan-style-guide.md mục 11.
 *
 * Mọi màn hình nhập từ đây, không nhập thẳng từ file con: đường dẫn ổn định thì
 * đổi cấu trúc thư mục về sau không phải sửa 50 chỗ import.
 *
 * | Mục docs/16 | Component |
 * |---|---|
 * | 11.1  | `Button`, `IconButton` |
 * | 11.2  | `Checkbox` |
 * | 11.3  | `Radio`, `RadioGroup` |
 * | 11.4  | `Select` |
 * | 11.5  | `Field`, `TextInput`, `TextArea` |
 * | 11.6  | `FilterChip`, `FilterChipGroup` |
 * | 11.7  | `Badge` + các hàm ánh xạ trạng thái → tông màu |
 * | 11.8  | `Avatar` |
 * | 11.9  | `Card`, `ClickableCard`, `StatCard` |
 * | 11.11 | `SkeletonBlock`, `TableSkeleton`, `CardSkeleton`, `StatCardSkeleton`, `ListSkeleton` |
 * | 11.12 | `ToastProvider`, `useToast` |
 * | 11.13 | `Modal`, `ConfirmDialog` |
 * | 11.14 | `Drawer` |
 * | 11.16 | `Fab` |
 * | 11.17 | `BulkActionBar`, `BulkAction` |
 * | 11.18 | `EmptyState`, `ErrorState` |
 * | 11.19 | `BottomSheet` |
 * | 11.20 | `NotificationItem` |
 * | mục 9 | `Icon` |
 *
 * Chưa có ở đây và vì sao: **Bảng** (11.10) dùng `<Table>` của Ant Design qua
 * `components/DataTable.tsx` — nó đã cho sẵn phân trang server-side, cột dính,
 * chọn dòng và `<th scope="col">` đúng chuẩn; viết lại là bỏ đi hàng nghìn dòng
 * đã kiểm chứng. **Sidenav** (11.15) chỉ dùng đúng một chỗ nên nằm luôn trong
 * `routes/layouts/ManagerLayout.tsx`.
 */

export { Button, IconButton } from './Button';
export type { ButtonProps, ButtonSize, ButtonVariant, IconButtonProps } from './Button';

export { Icon, ICONS } from './Icon';
export type { IconSize } from './Icon';

export { Field } from './Field';
export type { FieldRenderProps } from './Field';

export { TextInput, TextArea, PasswordInput } from './TextInput';
export type { TextInputProps, TextAreaProps } from './TextInput';

export { Select } from './Select';
export type { SelectOption, SelectProps } from './Select';

export { Checkbox, Radio, RadioGroup } from './Choice';
export type { CheckboxProps, RadioProps } from './Choice';

export { FilterChip, FilterChipGroup } from './FilterChip';

export {
  Badge,
  dailyStatusTone,
  employeeStatusTone,
  periodStatusTone,
  requestStatusTone,
  severityTone,
} from './Badge';
export type { BadgeTone } from './Badge';

export { Avatar } from './Avatar';
export type { AvatarSize } from './Avatar';

export { Card, ClickableCard, StatCard } from './Card';

export {
  CardSkeleton,
  ListSkeleton,
  SkeletonBlock,
  StatCardSkeleton,
  TableSkeleton,
} from './Skeleton';

export { EmptyState, ErrorState } from './EmptyState';

export { ToastProvider, useToast } from './Toast';
export type { ToastAction, ToastTone } from './Toast';

export { Modal, ConfirmDialog } from './Modal';
export { Drawer, BottomSheet } from './Drawer';
export { Fab } from './Fab';
export { BulkActionBar, BulkAction } from './BulkActionBar';
export { NotificationItem } from './NotificationItem';
