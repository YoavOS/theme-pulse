import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

interface Props {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function DemoDataConfirmDialog({ open, onConfirm, onCancel }: Props) {
  return (
    <AlertDialog open={open} onOpenChange={(v) => !v && onCancel()}>
      <AlertDialogContent className="border-border bg-card">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-foreground">Switch to Demo Data?</AlertDialogTitle>
          <AlertDialogDescription className="text-muted-foreground">
            This will replace your real scan data with demo/placeholder data until you run a new scan.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={onCancel}>Cancel</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
            Switch to Demo
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
