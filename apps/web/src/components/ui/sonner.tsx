import { Toaster as SonnerToaster, type ToasterProps } from "sonner";
import { useTheme } from "@/lib/theme";

export function Toaster(props: ToasterProps) {
  const { theme } = useTheme();
  return (
    <SonnerToaster
      theme={theme}
      position="bottom-right"
      richColors
      closeButton
      {...props}
    />
  );
}

export { toast } from "sonner";
