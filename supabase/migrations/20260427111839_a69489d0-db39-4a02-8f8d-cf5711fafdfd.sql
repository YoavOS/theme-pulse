UPDATE public.fundamentals_scan_progress
SET processed = (SELECT COUNT(*) FROM public.fundamentals_scan_queue WHERE status IN ('done','failed','skipped')),
    succeeded = (SELECT COUNT(*) FROM public.fundamentals_scan_queue WHERE status='done'),
    failed = (SELECT COUNT(*) FROM public.fundamentals_scan_queue WHERE status='failed'),
    total_queued = (SELECT COUNT(*) FROM public.fundamentals_scan_queue),
    last_updated = now()
WHERE id = 1;