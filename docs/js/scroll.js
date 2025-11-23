function revealOnScroll() {
    const reveals = document.querySelectorAll('.reveal');

    for (const el of reveals) {
        const windowHeight = window.innerHeight;
        const elementTop = el.getBoundingClientRect().top;
        const elementBottom = el.getBoundingClientRect().bottom;
        const revealPoint = 150;

        if (elementTop < windowHeight - revealPoint && elementBottom > 0) {
            el.classList.add('active');
        } else {
            el.classList.remove('active');
        }
    }
}

window.addEventListener('scroll', revealOnScroll);
window.addEventListener('load', revealOnScroll);