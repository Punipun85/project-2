from database.supabase_client import get_supabase_client


supabase = get_supabase_client()


result = (
    supabase
    .table("contents")
    .select("*")
    .limit(1)
    .execute()
)


print(result)
