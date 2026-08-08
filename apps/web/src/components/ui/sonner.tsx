import { Toaster as SonnerToaster, type ToasterProps } from "sonner";

export function Toaster(props: ToasterProps) {
  return (
    // `theme` is pinned rather than read from a hook: the app has one theme.
    // Sonner's own default is "system", which would follow the OS and put light
    // toasts on this dark shell for anyone whose machine is set to light.
    <SonnerToaster
      theme="dark"
      position="bottom-right"
      richColors
      closeButton
      {...props}
    />
  );
}

export { toast } from "sonner";
