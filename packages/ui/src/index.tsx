"use client";

import {
  Button,
  Callout,
  Classes,
  FormGroup,
  HTMLSelect,
  InputGroup,
  Menu,
  MenuItem,
  NonIdealState,
  Spinner,
  Tag,
  Tooltip,
  type ButtonProps,
  type IconName,
} from "@blueprintjs/core";
import { Icon } from "@blueprintjs/core";
import type { ReactElement, ReactNode } from "react";

export { Classes };
// Modern Blueprint popover supports React 19 without the legacy findDOMNode path.
export { PopoverNext as AppPopover, PopupKind } from "@blueprintjs/core";
// Blueprint dialog and drawer primitives (focus trap, focus restoration, escape handling) for compact, accessible dialogs.
export { Dialog as AppDialog, DialogBody as AppDialogBody, DialogFooter as AppDialogFooter, Drawer as AppDrawer, Position as AppPosition } from "@blueprintjs/core";
export type { IconName };

export function ActionButton(props: ButtonProps) {
  return <Button {...props} />;
}

export function AppIcon({ icon, label }: { icon: IconName; label?: string }) {
  return <Icon icon={icon} aria-label={label} />;
}

export function StatusTag({ children, intent = "none" }: { children: ReactNode; intent?: "none" | "primary" | "success" | "warning" | "danger" }) {
  return (
    <Tag intent={intent} minimal>
      {children}
    </Tag>
  );
}

export function Notice({ children, title }: { children: ReactNode; title?: string }) {
  return <Callout {...(title === undefined ? {} : { title })}>{children}</Callout>;
}

export function EmptyState({
  title,
  description,
  icon = "document",
  action,
}: {
  title: string;
  description: string;
  icon?: IconName;
  action?: ReactElement;
}) {
  return (
    <NonIdealState
      icon={icon}
      title={title}
      description={description}
      {...(action === undefined ? {} : { action })}
    />
  );
}

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return <Spinner size={22} aria-label={label} />;
}

export function TextField({
  label,
  name,
  placeholder,
  disabled,
  helperText,
}: {
  label: string;
  name: string;
  placeholder?: string;
  disabled?: boolean;
  helperText?: string;
}) {
  return (
    <FormGroup label={label} labelFor={name} helperText={helperText}>
      <InputGroup id={name} name={name} placeholder={placeholder} disabled={disabled} />
    </FormGroup>
  );
}

export function SelectField({
  label,
  name,
  children,
  disabled,
}: {
  label: string;
  name: string;
  children: ReactNode;
  disabled?: boolean;
}) {
  return (
    <FormGroup label={label} labelFor={name}>
      <HTMLSelect id={name} name={name} {...(disabled === undefined ? {} : { disabled })} fill>
        {children}
      </HTMLSelect>
    </FormGroup>
  );
}

export function Hint({ content, children }: { content: string; children: ReactNode }) {
  return <Tooltip content={content}>{children}</Tooltip>;
}

export function NavigationMenu({ children }: { children: ReactNode }) {
  return <Menu>{children}</Menu>;
}

export function NavigationItem({
  text,
  icon,
  active,
  href,
}: {
  text: string;
  icon: IconName;
  active?: boolean;
  href: string;
}) {
  return <MenuItem text={text} icon={icon} href={href} {...(active === undefined ? {} : { active })} />;
}
