# انتشار عمومی یاروان در GitHub

مقصد پیشنهادی: **`OWNER/yarvan-agent`**. به‌جای `OWNER` نام حساب یا سازمانی را بگذار که اجازهٔ ساخت مخزن در آن داری. برای سازمان، سیاست ساخت مخزن و اجازهٔ انتشار عمومی را هم بررسی کن. این راهنما توکن یا رمز نمی‌گیرد.

## از Git bundle آماده

Git و [GitHub CLI](https://cli.github.com/) را روی دستگاهی که به حسابت دسترسی دارد نصب کن. دستورهای زیر یک مخزن تازه می‌سازند، نه اینکه مخزن موجودی را بازنویسی کنند:

```bash
git clone -b main ./Yarvan-v0.1.0-github.bundle yarvan-agent
cd yarvan-agent
git remote rename origin source-bundle
git status --short
git ls-tree -d HEAD enterprise  # باید خروجی نداشته باشد

gh auth login --hostname github.com --web --git-protocol https
gh auth status --hostname github.com
gh repo create OWNER/yarvan-agent --public --source=. --remote=origin --push \
  --description "یاروان · Local-first AI agents with scoped memory, private Telegram and browser teaching"
gh repo view OWNER/yarvan-agent --json url,visibility,defaultBranchRef
```

اگر مخزن همنام قبلاً ساخته شده، **متوقف شو و آن را بررسی کن**؛ نه فورس‌پوش بزن و نه محتوایش را پاک کن. اگر فقط ZIP داری، آن را در پوشه‌ای تازه باز کن، داخل پوشهٔ سورس `git init -b main` بزن، `git status` را کنترل کن و بعد از `git add .` یک commit با هویت Git خودت بساز. سپس از خط `gh auth login` ادامه بده.

## پیش از عمومی کردن

- [LICENSE](../../LICENSE) و [NOTICE](../../NOTICE) را حذف نکن. فقط سورس نسخهٔ متن‌باز را منتشر کن؛ `enterprise/` یا تاریخچه‌ای که آن پوشه را دارد نباید وارد مخزن عمومی شود.
- `~/.yarvan/`، خروجی پشتیبان، فایل `.env` واقعی، کلید مدل، توکن تلگرام، پروفایل مرورگر و متن چت را **به مخزن یا Release ضمیمه نکن**. `.env.example` فقط نمونه است.
- یک‌بار README و لینک‌های راهنما را از تب Code بررسی کن. سپس Actions را در GitHub چک کن. انتشار مخزن با ساخت نصاب امضاشده یا استقرار روی سرور یکی نیست.

در صورت تمایل به ساخت Release، پس از بررسی مخزن، `gh release create v0.1.0 --target main --title "یاروان ۰٫۱٫۰" --notes-file CHANGELOG.md` نسخهٔ سورس را ثبت می‌کند. به‌جای اشاره به دانلودهای بالادست، آن را صریحاً «Source release» معرفی کن.
